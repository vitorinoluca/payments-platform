import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { Account } from '../entities/account.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransfersService } from './transfers.service';

function makeQueryBuilder(result: unknown) {
  const qb: any = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
    getRawOne: jest.fn().mockResolvedValue(result),
  };
  return qb;
}

function makeQueryRunner(
  accounts: Account[],
  sum: string,
  opts: { idempotencyConflict?: boolean; cachedResponse?: unknown; requestHash?: string } = {},
) {
  const entrySaveMock = jest.fn().mockImplementation((entries) => Promise.resolve(entries));
  const transactionSaveMock = jest.fn().mockImplementation((t) => Promise.resolve({ id: 'tx-1', ...t }));

  const accountRepo = { createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(accounts)) };
  const entryRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder({ sum })),
    create: jest.fn().mockImplementation((e) => e),
    save: entrySaveMock,
  };
  const transactionRepo = {
    create: jest.fn().mockImplementation((t) => t),
    save: transactionSaveMock,
  };
  const idempotencyRepo = {
    findOneBy: jest.fn().mockResolvedValue({ key: 'k', responseBody: opts.cachedResponse, requestHash: opts.requestHash }),
    update: jest.fn().mockResolvedValue(undefined),
  };

  const getRepository = jest.fn().mockImplementation((entity) => {
    if (entity === Account) return accountRepo;
    if (entity === LedgerEntry) return entryRepo;
    if (entity === Transaction) return transactionRepo;
    if (entity === IdempotencyKey) return idempotencyRepo;
    throw new Error('repositorio inesperado');
  });

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(opts.idempotencyConflict ? [] : [{ key: 'k' }]),
    manager: { getRepository },
  };
}

describe('TransfersService', () => {
  const fromId = '11111111-1111-1111-1111-111111111111';
  const toId = '22222222-2222-2222-2222-222222222222';
  const idempotencyKey = 'idem-key-1';

  function build(
    accounts: Account[],
    sum: string,
    opts: {
      idempotencyConflict?: boolean;
      cachedResponse?: unknown;
      requestHash?: string;
      fraudFlagged?: boolean;
      fxRate?: number;
    } = {},
  ) {
    const queryRunner = makeQueryRunner(accounts, sum, opts);
    const dataSource = { createQueryRunner: jest.fn().mockReturnValue(queryRunner) } as unknown as DataSource;
    const fraudService = {
      evaluate: jest
        .fn()
        .mockResolvedValue(opts.fraudFlagged ? { flagged: true, reason: 'motivo de prueba' } : { flagged: false }),
    };
    const realtimeGateway = { notifyTransfer: jest.fn() };
    const webhooksService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const rate = opts.fxRate ?? 1;
    const fxService = {
      getRate: jest.fn().mockResolvedValue(rate),
      convert: jest.fn().mockImplementation((amt: bigint, r: number) => BigInt(Math.round(Number(amt) * r))),
    };
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new TransfersService(
      dataSource,
      fraudService as any,
      realtimeGateway as any,
      webhooksService as any,
      fxService as any,
      auditService as any,
    );
    return { service, queryRunner, fraudService, realtimeGateway, webhooksService, fxService, auditService };
  }

  it('ejecuta una transferencia válida dentro de una transacción y hace commit', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'USD' } as Account,
    ];
    const { service, queryRunner, realtimeGateway, webhooksService } = build(accounts, '100');

    const result = await service.transfer(
      { fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' },
      idempotencyKey,
    );

    expect(result).toMatchObject({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' });
    expect(queryRunner.manager.getRepository(LedgerEntry).save).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: fromId, amountMinorUnits: '-30' }),
      expect.objectContaining({ accountId: toId, amountMinorUnits: '30' }),
    ]);
    expect(queryRunner.manager.getRepository(IdempotencyKey).update).toHaveBeenCalledWith(
      { key: idempotencyKey },
      { responseBody: result },
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(realtimeGateway.notifyTransfer).toHaveBeenCalledWith(result);
    expect(webhooksService.dispatch).toHaveBeenCalledWith('transfer.updated', result);
  });

  it('devuelve la respuesta cacheada si la Idempotency-Key ya fue usada, sin tocar el ledger', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'USD' } as Account,
    ];
    const cachedResponse = { id: 'tx-cacheada' };
    const dto = { fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' };
    const { service, queryRunner, realtimeGateway, webhooksService } = build(accounts, '100', {
      idempotencyConflict: true,
      cachedResponse,
      requestHash: createHash('sha256').update(JSON.stringify(dto)).digest('hex'),
    });

    const result = await service.transfer(dto, idempotencyKey);

    expect(result).toEqual(cachedResponse);
    expect(queryRunner.manager.getRepository(Account).createQueryBuilder).not.toHaveBeenCalled();
    expect(queryRunner.manager.getRepository(LedgerEntry).save).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(realtimeGateway.notifyTransfer).not.toHaveBeenCalled();
    expect(webhooksService.dispatch).not.toHaveBeenCalled();
  });

  it('rechaza si la Idempotency-Key ya fue usada con un body distinto', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'USD' } as Account,
    ];
    const { service, queryRunner } = build(accounts, '100', {
      idempotencyConflict: true,
      cachedResponse: { id: 'tx-original' },
      requestHash: 'hash-de-otro-request',
    });

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' }, idempotencyKey),
    ).rejects.toThrow(ConflictException);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('retiene la transferencia como flagged cuando el motor de fraude la marca, sin mover el ledger', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'USD' } as Account,
    ];
    const { service, queryRunner, fraudService, realtimeGateway, webhooksService } = build(accounts, '100', {
      fraudFlagged: true,
    });

    const result = await service.transfer(
      { fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' },
      idempotencyKey,
    );

    expect(fraudService.evaluate).toHaveBeenCalledWith(queryRunner.manager, fromId, 30n);
    expect(result).toMatchObject({ status: 'flagged', fromAccountId: fromId, toAccountId: toId });
    expect(queryRunner.manager.getRepository(LedgerEntry).save).not.toHaveBeenCalled();
    expect(queryRunner.manager.getRepository(IdempotencyKey).update).toHaveBeenCalledWith(
      { key: idempotencyKey },
      { responseBody: result },
    );
    expect(realtimeGateway.notifyTransfer).toHaveBeenCalledWith(result);
    expect(webhooksService.dispatch).toHaveBeenCalledWith('transfer.updated', result);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('rechaza si falta el header Idempotency-Key', async () => {
    const { service, queryRunner } = build([], '0');

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' }, ''),
    ).rejects.toThrow(BadRequestException);
    expect(queryRunner.connect).not.toHaveBeenCalled();
  });

  it('rechaza fondos insuficientes y hace rollback', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'USD' } as Account,
    ];
    const { service, queryRunner } = build(accounts, '10');

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' }, idempotencyKey),
    ).rejects.toThrow(ConflictException);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('rechaza si alguna cuenta no existe', async () => {
    const accounts = [{ id: fromId, currency: 'USD' } as Account];
    const { service, queryRunner } = build(accounts, '100');

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' }, idempotencyKey),
    ).rejects.toThrow(NotFoundException);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('convierte el monto a la moneda destino usando la tasa de FxService', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'ARS' } as Account,
    ];
    const { service, queryRunner, fxService } = build(accounts, '100', { fxRate: 3.5 });

    const result = await service.transfer(
      { fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '30' },
      idempotencyKey,
    );

    expect(fxService.getRate).toHaveBeenCalledWith('USD', 'ARS');
    expect(result).toMatchObject({
      currency: 'USD',
      toCurrency: 'ARS',
      exchangeRate: '3.5',
      convertedAmountMinorUnits: '105',
    });
    expect(queryRunner.manager.getRepository(LedgerEntry).save).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: fromId, amountMinorUnits: '-30' }),
      expect.objectContaining({ accountId: toId, amountMinorUnits: '105' }),
    ]);
  });

  it('rechaza si el monto convertido redondea a cero', async () => {
    const accounts = [
      { id: fromId, currency: 'USD' } as Account,
      { id: toId, currency: 'JPY' } as Account,
    ];
    const { service, queryRunner } = build(accounts, '100', { fxRate: 0 });

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '1' }, idempotencyKey),
    ).rejects.toThrow(BadRequestException);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('rechaza montos no positivos sin abrir una transacción', async () => {
    const { service, queryRunner } = build([], '0');
    const dataSource = (service as any).dataSource as { createQueryRunner: jest.Mock };

    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: '0' }, idempotencyKey),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(queryRunner.connect).not.toHaveBeenCalled();
  });

  it('rechaza montos no numéricos', async () => {
    const { service } = build([], '0');
    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: toId, amountMinorUnits: 'abc' }, idempotencyKey),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza transferencias a la misma cuenta', async () => {
    const { service } = build([], '0');
    await expect(
      service.transfer({ fromAccountId: fromId, toAccountId: fromId, amountMinorUnits: '10' }, idempotencyKey),
    ).rejects.toThrow(BadRequestException);
  });
});
