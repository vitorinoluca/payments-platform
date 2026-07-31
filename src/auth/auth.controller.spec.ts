import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let service: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    setupTwoFactor: jest.Mock;
    enableTwoFactor: jest.Mock;
    disableTwoFactor: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      register: jest.fn().mockResolvedValue({ accessToken: 't', user: { id: '1', email: 'a@test.com' } }),
      login: jest.fn().mockResolvedValue({ accessToken: 't', user: { id: '1', email: 'a@test.com' } }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 't2', refreshToken: 'r2', user: { id: '1', email: 'a@test.com' } }),
      setupTwoFactor: jest.fn().mockResolvedValue({ secret: 's', otpauthUrl: 'otpauth://...' }),
      enableTwoFactor: jest.fn().mockResolvedValue({ twoFactorEnabled: true }),
      disableTwoFactor: jest.fn().mockResolvedValue({ twoFactorEnabled: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  it('delega el registro al service', async () => {
    const dto = { email: 'a@test.com', password: 'secret123' };
    const result = await controller.register(dto);

    expect(service.register).toHaveBeenCalledWith(dto);
    expect(result.accessToken).toBe('t');
  });

  it('delega el login al service', async () => {
    const dto = { email: 'a@test.com', password: 'secret123' };
    const result = await controller.login(dto);

    expect(service.login).toHaveBeenCalledWith(dto);
    expect(result.accessToken).toBe('t');
  });

  it('delega el refresh al service', async () => {
    const dto = { refreshToken: 'un-token' };
    const result = await controller.refresh(dto);

    expect(service.refresh).toHaveBeenCalledWith(dto);
    expect(result.accessToken).toBe('t2');
  });

  it('delega el setup de 2FA al service con el id del usuario actual', async () => {
    const result = await controller.setupTwoFactor({ sub: 'user-1', email: 'a@test.com' });

    expect(service.setupTwoFactor).toHaveBeenCalledWith('user-1');
    expect(result.secret).toBe('s');
  });

  it('delega la activación de 2FA al service', async () => {
    const result = await controller.enableTwoFactor({ sub: 'user-1', email: 'a@test.com' }, { code: '123456' });

    expect(service.enableTwoFactor).toHaveBeenCalledWith('user-1', '123456');
    expect(result.twoFactorEnabled).toBe(true);
  });

  it('delega la desactivación de 2FA al service', async () => {
    const result = await controller.disableTwoFactor({ sub: 'user-1', email: 'a@test.com' }, { code: '123456' });

    expect(service.disableTwoFactor).toHaveBeenCalledWith('user-1', '123456');
    expect(result.twoFactorEnabled).toBe(false);
  });
});
