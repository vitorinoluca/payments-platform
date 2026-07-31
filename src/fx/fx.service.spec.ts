import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FxService } from './fx.service';

describe('FxService', () => {
  let service: FxService;
  let redis: { get: jest.Mock; set: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    service = new FxService(redis as any);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('devuelve 1 sin llamar a la API ni a Redis si origen y destino son la misma moneda', async () => {
    const rate = await service.getRate('USD', 'USD');
    expect(rate).toBe(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa el cache de Redis si ya hay tasas para esa moneda base', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ ARS: 1000, EUR: 0.9 }));

    const rate = await service.getRate('USD', 'ARS');

    expect(rate).toBe(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta la API externa y cachea el resultado si no hay nada en Redis', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { EUR: 0.92 } }),
    });

    const rate = await service.getRate('USD', 'EUR');

    expect(rate).toBe(0.92);
    expect(fetchMock).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD');
    expect(redis.set).toHaveBeenCalledWith('fx:rates:USD', JSON.stringify({ EUR: 0.92 }), { EX: 300 });
  });

  it('lanza si la moneda destino no existe en la respuesta', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { EUR: 0.92 } }),
    });

    await expect(service.getRate('USD', 'XXX')).rejects.toThrow(BadRequestException);
  });

  it('lanza si la API externa responde con error http', async () => {
    fetchMock.mockResolvedValue({ ok: false });

    await expect(service.getRate('USD', 'EUR')).rejects.toThrow(ServiceUnavailableException);
  });

  it('lanza si la API externa responde sin éxito', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: 'error' }) });

    await expect(service.getRate('USD', 'EUR')).rejects.toThrow(ServiceUnavailableException);
  });

  it('convierte montos usando aritmética entera escalada, sin floats', () => {
    expect(service.convert(100n, 3.5)).toBe(350n);
    expect(service.convert(1000n, 0.92)).toBe(920n);
  });
});
