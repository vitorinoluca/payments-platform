import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import type { AuthenticatedUser } from './guards/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// login y register son los blancos típicos de fuerza bruta / credential stuffing:
// límite más estricto que el default global de la app
const BRUTE_FORCE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle(BRUTE_FORCE_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle(BRUTE_FORCE_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupTwoFactor(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorCodeDto) {
    return this.authService.enableTwoFactor(user.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorCodeDto) {
    return this.authService.disableTwoFactor(user.sub, dto.code);
  }
}
