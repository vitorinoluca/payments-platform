import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditLog } from '../src/audit/entities/audit-log.entity';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0); // evita listen() concurrente cuando supertest dispara requests en paralelo
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registra, loguea y audita los eventos de éxito y fracaso', async () => {
    const email = `auth-smoke-${randomUUID()}@test.com`;

    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'secret123' });
    expect(registerResponse.status).toBe(201);
    const userId = registerResponse.body.user.id;

    const loginOk = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'secret123' });
    expect(loginOk.status).toBe(200);

    const loginFail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'incorrecta' });
    expect(loginFail.status).toBe(401);

    const auditRepo = dataSource.getRepository(AuditLog);
    const events = await auditRepo.find({ where: { userId } });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('auth.register');
    expect(actions).toContain('auth.login.success');
    expect(actions).toContain('auth.login.failure');
  });

  it('exige 2FA en el login una vez habilitado, y lo rechaza con un código incorrecto', async () => {
    const email = `2fa-smoke-${randomUUID()}@test.com`;

    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'secret123' });
    const accessToken = registerResponse.body.accessToken;

    const setupResponse = await request(app.getHttpServer())
      .post('/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setupResponse.status).toBe(201);
    const { secret } = setupResponse.body;

    const validCode = authenticator.generate(secret);
    const enableResponse = await request(app.getHttpServer())
      .post('/auth/2fa/enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: validCode });
    expect(enableResponse.status).toBe(200);
    expect(enableResponse.body.twoFactorEnabled).toBe(true);

    const loginWithoutCode = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'secret123' });
    expect(loginWithoutCode.status).toBe(401);

    const loginWithWrongCode = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'secret123', twoFactorCode: '000000' });
    expect(loginWithWrongCode.status).toBe(401);

    const loginWithValidCode = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'secret123', twoFactorCode: authenticator.generate(secret) });
    expect(loginWithValidCode.status).toBe(200);
    expect(loginWithValidCode.body.accessToken).toEqual(expect.any(String));
  });

  it('rechaza setup/enable/disable de 2FA sin un access token válido', async () => {
    const setupResponse = await request(app.getHttpServer()).post('/auth/2fa/setup');
    expect(setupResponse.status).toBe(401);

    const enableResponse = await request(app.getHttpServer()).post('/auth/2fa/enable').send({ code: '123456' });
    expect(enableResponse.status).toBe(401);
  });

  it('rate limita /auth/login después de demasiados intentos seguidos', async () => {
    const email = `ratelimit-smoke-${randomUUID()}@test.com`;

    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        request(app.getHttpServer()).post('/auth/login').send({ email, password: 'lo-que-sea' }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);
  });
});
