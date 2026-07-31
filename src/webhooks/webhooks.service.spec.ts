import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let repo: { save: jest.Mock; create: jest.Mock; findBy: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockImplementation((e) => e),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'wh-1', active: true, ...e })),
      findBy: jest.fn().mockResolvedValue([]),
    };
    service = new WebhooksService(repo as any);
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (global as any).fetch = fetchMock;
  });

  it('registra un endpoint válido y genera un secret', async () => {
    const result = await service.register('https://example.com/hook');

    expect(result).toMatchObject({ id: 'wh-1', url: 'https://example.com/hook' });
    expect(result.secret).toEqual(expect.any(String));
    expect(result.secret.length).toBeGreaterThan(10);
  });

  it('rechaza una url mal formada', async () => {
    await expect(service.register('no-es-una-url')).rejects.toThrow(BadRequestException);
  });

  it('rechaza una url que no sea http/https', async () => {
    await expect(service.register('ftp://example.com/hook')).rejects.toThrow(BadRequestException);
  });

  it('despacha el evento a todos los endpoints activos con firma HMAC válida', async () => {
    repo.findBy.mockResolvedValue([{ id: 'wh-1', url: 'https://example.com/hook', secret: 'un-secreto', active: true }]);

    await service.dispatch('transfer.updated', { id: 'tx-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(options.method).toBe('POST');

    const expectedSignature = createHmac('sha256', 'un-secreto').update(options.body).digest('hex');
    expect(options.headers['X-Webhook-Signature']).toBe(expectedSignature);
    expect(JSON.parse(options.body)).toEqual({ event: 'transfer.updated', data: { id: 'tx-1' } });
  });

  it('no lanza si un endpoint falla al entregarse', async () => {
    repo.findBy.mockResolvedValue([{ id: 'wh-1', url: 'https://caído.example.com', secret: 's', active: true }]);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.dispatch('transfer.updated', { id: 'tx-1' })).resolves.toBeUndefined();
  });
});
