import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(headers: Record<string, string>) {
  const request: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext & { __request: any };
}

describe('JwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    guard = new JwtAuthGuard(jwtService as any);
  });

  it('permite el acceso y adjunta el usuario decodificado con un Bearer token válido', () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@test.com' });
    const context = makeContext({ authorization: 'Bearer un-token-valido' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('un-token-valido');
    const request = context.switchToHttp().getRequest();
    expect(request.user).toEqual({ sub: 'user-1', email: 'a@test.com' });
  });

  it('rechaza si falta el header Authorization', () => {
    const context = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza si el header no es Bearer', () => {
    const context = makeContext({ authorization: 'Basic algo' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza si el token es inválido o expiró', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const context = makeContext({ authorization: 'Bearer un-token-vencido' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
