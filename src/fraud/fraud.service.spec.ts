import { EntityManager } from 'typeorm';
import { Transaction } from '../ledger/entities/transaction.entity';
import { FraudService } from './fraud.service';

function makeManager(count: number) {
  const repo = { count: jest.fn().mockResolvedValue(count) };
  const getRepository = jest.fn().mockImplementation((entity) => {
    if (entity === Transaction) return repo;
    throw new Error('repositorio inesperado');
  });
  return { getRepository, repo } as unknown as EntityManager & { repo: { count: jest.Mock } };
}

describe('FraudService', () => {
  const service = new FraudService();
  const accountId = '11111111-1111-1111-1111-111111111111';

  it('marca como flagged un monto por encima del umbral, sin consultar velocidad', async () => {
    const manager = makeManager(0);

    const result = await service.evaluate(manager, accountId, 1_000_000n);

    expect(result).toEqual({ flagged: true, reason: expect.stringContaining('monto') });
    expect((manager as any).repo.count).not.toHaveBeenCalled();
  });

  it('marca como flagged si hay demasiadas transferencias recientes desde la misma cuenta', async () => {
    const manager = makeManager(25);

    const result = await service.evaluate(manager, accountId, 100n);

    expect(result).toEqual({ flagged: true, reason: expect.stringContaining('transferencias') });
  });

  it('no marca como flagged un monto y velocidad normales', async () => {
    const manager = makeManager(1);

    const result = await service.evaluate(manager, accountId, 100n);

    expect(result).toEqual({ flagged: false });
  });
});
