import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedUser {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('token de acceso requerido');
    }

    try {
      // sin pasar "secret" explícito usa el default (JWT_SECRET) configurado en
      // JwtModule, que es distinto del secret de los refresh tokens: un refresh
      // token nunca puede colarse acá como si fuera un access token
      const payload = this.jwtService.verify<AuthenticatedUser>(token);
      (request as Request & { user: AuthenticatedUser }).user = payload;
    } catch {
      throw new UnauthorizedException('token de acceso inválido o expirado');
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }
    const [type, token] = header.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
