import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOTP_ISSUER = 'PaymentsPlatform';

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    configService: ConfigService,
  ) {
    this.refreshSecret = configService.get<string>('JWT_REFRESH_SECRET')!;
  }

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException('el email ya está registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.userRepo.save(this.userRepo.create({ email: dto.email, passwordHash }));

    await this.auditService.record('auth.register', user.id, { email: user.email });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user) {
      await this.auditService.record('auth.login.failure', null, { email: dto.email, reason: 'usuario no existe' });
      throw new UnauthorizedException('credenciales inválidas');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.auditService.record('auth.login.failure', user.id, { reason: 'password incorrecta' });
      throw new UnauthorizedException('credenciales inválidas');
    }

    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode) {
        throw new UnauthorizedException('se requiere código de 2FA');
      }
      if (!authenticator.check(dto.twoFactorCode, user.twoFactorSecret!)) {
        await this.auditService.record('auth.login.failure', user.id, { reason: 'código 2FA inválido' });
        throw new UnauthorizedException('código 2FA inválido');
      }
    }

    await this.auditService.record('auth.login.success', user.id);
    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto) {
    let payload: { sub: string; jti: string };
    try {
      payload = this.jwtService.verify(dto.refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('refresh token inválido');
    }

    const record = await this.refreshTokenRepo.findOneBy({ id: payload.jti });

    // si el token no existe, no pertenece a este usuario, o ya fue usado/revocado,
    // se revocan todos los refresh tokens del usuario (posible robo/reuso)
    if (!record || record.revoked || record.userId !== payload.sub) {
      await this.refreshTokenRepo.update({ userId: payload.sub }, { revoked: true });
      await this.auditService.record('auth.refresh.reuse_detected', payload.sub);
      throw new UnauthorizedException('refresh token inválido o ya utilizado');
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('refresh token expirado');
    }

    const user = await this.userRepo.findOneBy({ id: payload.sub });
    if (!user) {
      throw new UnauthorizedException('usuario no encontrado');
    }

    record.revoked = true;
    await this.refreshTokenRepo.save(record);

    return this.issueTokens(user);
  }

  async setupTwoFactor(userId: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new UnauthorizedException('usuario no encontrado');
    }

    const secret = authenticator.generateSecret();
    user.twoFactorSecret = secret;
    await this.userRepo.save(user);

    return { secret, otpauthUrl: authenticator.keyuri(user.email, TOTP_ISSUER, secret) };
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('primero hay que generar un secret con /auth/2fa/setup');
    }
    if (!authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedException('código 2FA inválido');
    }

    user.twoFactorEnabled = true;
    await this.userRepo.save(user);
    await this.auditService.record('auth.2fa.enabled', user.id);

    return { twoFactorEnabled: true };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA no está habilitado');
    }
    if (!authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedException('código 2FA inválido');
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await this.userRepo.save(user);
    await this.auditService.record('auth.2fa.disabled', user.id);

    return { twoFactorEnabled: false };
  }

  private async issueTokens(user: User) {
    const refreshRecord = await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      }),
    );

    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email }, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: refreshRecord.id },
      { secret: this.refreshSecret, expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken, user: { id: user.id, email: user.email } };
  }
}
