import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

const REFRESH_SECRET = 'refresh-secret';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let refreshTokenRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let savedUsers: User[];
  let savedRefreshTokens: RefreshToken[];

  beforeEach(async () => {
    savedUsers = [];
    savedRefreshTokens = [];

    userRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((u) => u),
      save: jest.fn().mockImplementation((u) => {
        const saved = { id: `user-${savedUsers.length + 1}`, ...u } as User;
        savedUsers.push(saved);
        return Promise.resolve(saved);
      }),
    };

    refreshTokenRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((r) => r),
      save: jest.fn().mockImplementation((r) => {
        const saved = { id: r.id ?? `rt-${savedRefreshTokens.length + 1}`, revoked: false, ...r } as RefreshToken;
        savedRefreshTokens.push(saved);
        return Promise.resolve(saved);
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    jwtService = {
      sign: jest.fn().mockImplementation((_payload, opts) => (opts?.secret === REFRESH_SECRET ? 'signed-refresh' : 'signed-access')),
      verify: jest.fn(),
    };

    const configService = { get: jest.fn().mockReturnValue(REFRESH_SECRET) } as unknown as ConfigService;
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokenRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: AuditService, useValue: auditService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('registra un usuario nuevo y devuelve access + refresh token', async () => {
    const result = await service.register({ email: 'a@test.com', password: 'secret123' });

    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@test.com', passwordHash: expect.any(String) }),
    );
    expect(result).toEqual({
      accessToken: 'signed-access',
      refreshToken: 'signed-refresh',
      user: { id: 'user-1', email: 'a@test.com' },
    });
  });

  it('rechaza el registro si el email ya existe', async () => {
    userRepo.findOneBy.mockResolvedValue({ id: 'user-1', email: 'a@test.com' });

    await expect(service.register({ email: 'a@test.com', password: 'secret123' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('loguea con credenciales válidas', async () => {
    await service.register({ email: 'b@test.com', password: 'secret123' });
    userRepo.findOneBy.mockResolvedValue(savedUsers[0]);

    const result = await service.login({ email: 'b@test.com', password: 'secret123' });
    expect(result.accessToken).toBe('signed-access');
    expect(result.refreshToken).toBe('signed-refresh');
  });

  it('rechaza login si el usuario no existe', async () => {
    await expect(service.login({ email: 'nadie@test.com', password: 'x' })).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza login con password incorrecta', async () => {
    await service.register({ email: 'c@test.com', password: 'secret123' });
    userRepo.findOneBy.mockResolvedValue(savedUsers[0]);

    await expect(service.login({ email: 'c@test.com', password: 'incorrecta' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rota el refresh token: lo marca revocado y emite un par nuevo', async () => {
    const user = { id: 'user-1', email: 'a@test.com' } as User;
    const oldRecord = { id: 'rt-1', userId: user.id, revoked: false, expiresAt: new Date(Date.now() + 10_000) };

    jwtService.verify.mockReturnValue({ sub: user.id, jti: oldRecord.id });
    refreshTokenRepo.findOneBy.mockResolvedValue(oldRecord);
    userRepo.findOneBy.mockResolvedValue(user);

    const result = await service.refresh({ refreshToken: 'un-refresh-token' });

    expect(refreshTokenRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'rt-1', revoked: true }));
    expect(result.accessToken).toBe('signed-access');
    expect(result.refreshToken).toBe('signed-refresh');
  });

  it('rechaza un refresh token con firma inválida', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(service.refresh({ refreshToken: 'basura' })).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza y revoca todos los tokens del usuario si el refresh token ya fue usado', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'rt-ya-usado' });
    refreshTokenRepo.findOneBy.mockResolvedValue({ id: 'rt-ya-usado', userId: 'user-1', revoked: true });

    await expect(service.refresh({ refreshToken: 'token-reusado' })).rejects.toThrow(UnauthorizedException);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { revoked: true });
  });

  it('rechaza un refresh token que no existe en la base', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'no-existe' });
    refreshTokenRepo.findOneBy.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: 'token-inexistente' })).rejects.toThrow(UnauthorizedException);
    expect(refreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { revoked: true });
  });

  it('rechaza un refresh token expirado', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'rt-1' });
    refreshTokenRepo.findOneBy.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      revoked: false,
      expiresAt: new Date(Date.now() - 10_000),
    });

    await expect(service.refresh({ refreshToken: 'token-expirado' })).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza si el usuario del refresh token ya no existe', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-fantasma', jti: 'rt-1' });
    refreshTokenRepo.findOneBy.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-fantasma',
      revoked: false,
      expiresAt: new Date(Date.now() + 10_000),
    });
    userRepo.findOneBy.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: 'token-huerfano' })).rejects.toThrow(UnauthorizedException);
  });

  it('genera un secret de 2FA en el setup', async () => {
    const user = { id: 'user-1', email: 'a@test.com' } as User;
    userRepo.findOneBy.mockResolvedValue(user);

    const result = await service.setupTwoFactor('user-1');

    expect(result.secret).toEqual(expect.any(String));
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ twoFactorSecret: result.secret }));
  });

  it('habilita 2FA con un código válido', async () => {
    const secret = authenticator.generateSecret();
    const user = { id: 'user-1', email: 'a@test.com', twoFactorSecret: secret, twoFactorEnabled: false } as User;
    userRepo.findOneBy.mockResolvedValue(user);
    const code = authenticator.generate(secret);

    const result = await service.enableTwoFactor('user-1', code);

    expect(result).toEqual({ twoFactorEnabled: true });
    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabled: true }));
  });

  it('rechaza habilitar 2FA con un código inválido', async () => {
    const secret = authenticator.generateSecret();
    const user = { id: 'user-1', email: 'a@test.com', twoFactorSecret: secret, twoFactorEnabled: false } as User;
    userRepo.findOneBy.mockResolvedValue(user);

    await expect(service.enableTwoFactor('user-1', '000000')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza habilitar 2FA sin haber hecho setup antes', async () => {
    userRepo.findOneBy.mockResolvedValue({ id: 'user-1', twoFactorSecret: null } as User);

    await expect(service.enableTwoFactor('user-1', '123456')).rejects.toThrow(BadRequestException);
  });

  it('deshabilita 2FA con un código válido', async () => {
    const secret = authenticator.generateSecret();
    const user = { id: 'user-1', email: 'a@test.com', twoFactorSecret: secret, twoFactorEnabled: true } as User;
    userRepo.findOneBy.mockResolvedValue(user);
    const code = authenticator.generate(secret);

    const result = await service.disableTwoFactor('user-1', code);

    expect(result).toEqual({ twoFactorEnabled: false });
    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabled: false, twoFactorSecret: null }));
  });

  it('exige el código de 2FA al loguear si está habilitado', async () => {
    const secret = authenticator.generateSecret();
    await service.register({ email: 'd@test.com', password: 'secret123' });
    userRepo.findOneBy.mockResolvedValue({ ...savedUsers[0], twoFactorEnabled: true, twoFactorSecret: secret });

    await expect(service.login({ email: 'd@test.com', password: 'secret123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un código de 2FA inválido al loguear', async () => {
    const secret = authenticator.generateSecret();
    await service.register({ email: 'e@test.com', password: 'secret123' });
    userRepo.findOneBy.mockResolvedValue({ ...savedUsers[0], twoFactorEnabled: true, twoFactorSecret: secret });

    await expect(
      service.login({ email: 'e@test.com', password: 'secret123', twoFactorCode: '000000' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('loguea con un código de 2FA válido', async () => {
    const secret = authenticator.generateSecret();
    await service.register({ email: 'f@test.com', password: 'secret123' });
    userRepo.findOneBy.mockResolvedValue({ ...savedUsers[0], twoFactorEnabled: true, twoFactorSecret: secret });
    const code = authenticator.generate(secret);

    const result = await service.login({ email: 'f@test.com', password: 'secret123', twoFactorCode: code });

    expect(result.accessToken).toBe('signed-access');
  });
});
