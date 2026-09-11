import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FxService } from '../src/fx/fx.service';
import { Account } from '../src/ledger/entities/account.entity';
import { LedgerEntry } from '../src/ledger/entities/ledger-entry.entity';
import { Transaction, TransactionStatus } from '../src/ledger/entities/transaction.entity';

describe('POST /transfers - concurrencia (e2e)', () => {
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

  it('20 transferencias concurrentes sobre la misma cuenta origen nunca dejan el balance en negativo', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'USD' }));

    const initialBalance = 100n;
    const amountPerTransfer = 10n;
    const concurrentRequests = 20; // suficiente para pedir 200 cuando solo hay 100 disponibles

    // fondeo directo del ledger (fuera del endpoint) para dejar el balance inicial en 100
    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: initialBalance.toString(),
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: initialBalance.toString(),
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({
        transactionId: seedTransaction.id,
        accountId: source.id,
        amountMinorUnits: initialBalance.toString(),
      }),
    );

    const responses = await Promise.all(
      Array.from({ length: concurrentRequests }, (_, i) =>
        request(app.getHttpServer())
          .post('/transfers')
          .set('Idempotency-Key', `race-${randomUUID()}-${i}`)
          .send({
            fromAccountId: source.id,
            toAccountId: destination.id,
            amountMinorUnits: amountPerTransfer.toString(),
          }),
      ),
    );

    const successful = responses.filter((r) => r.status === 201 || r.status === 200);
    const rejected = responses.filter((r) => r.status === 409);

    // solo alcanza para 10 de las 20 transferencias (100 / 10)
    expect(successful).toHaveLength(10);
    expect(rejected).toHaveLength(10);

    const sourceSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: source.id })
      .getRawOne<{ sum: string }>();
    const destinationSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: destination.id })
      .getRawOne<{ sum: string }>();

    // el balance final nunca debe quedar negativo, sin importar la concurrencia
    expect(BigInt(sourceSum!.sum)).toBe(0n);
    expect(BigInt(destinationSum!.sum)).toBe(BigInt(successful.length) * amountPerTransfer);
  });

  it('20 llamadas concurrentes con la misma Idempotency-Key ejecutan la transferencia una sola vez', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'USD' }));

    const initialBalance = 100n;
    const amount = 30n;
    const sameKey = randomUUID();

    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: initialBalance.toString(),
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: initialBalance.toString(),
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({
        transactionId: seedTransaction.id,
        accountId: source.id,
        amountMinorUnits: initialBalance.toString(),
      }),
    );

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer())
          .post('/transfers')
          .set('Idempotency-Key', sameKey)
          .send({
            fromAccountId: source.id,
            toAccountId: destination.id,
            amountMinorUnits: amount.toString(),
          }),
      ),
    );

    // todas las respuestas deben ser exitosas y devolver la misma transacción
    const transactionIds = new Set(responses.map((r) => r.body.id));
    expect(responses.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(transactionIds.size).toBe(1);

    const transactionCount = await transactionRepo.count({ where: { toAccountId: destination.id } });
    expect(transactionCount).toBe(1);

    const destinationSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: destination.id })
      .getRawOne<{ sum: string }>();

    // el efecto se aplicó una sola vez, no 20 veces
    expect(BigInt(destinationSum!.sum)).toBe(amount);
  });

  it('retiene (flagged) una transferencia por monto alto, sin mover el ledger', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'USD' }));

    const initialBalance = 2_000_000n;
    const highAmount = 1_000_000n; // igual al umbral de fraude por monto

    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: initialBalance.toString(),
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: initialBalance.toString(),
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({
        transactionId: seedTransaction.id,
        accountId: source.id,
        amountMinorUnits: initialBalance.toString(),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Idempotency-Key', randomUUID())
      .send({
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinorUnits: highAmount.toString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('flagged');

    // se retuvo: no se generaron ledger_entries para esta transferencia
    const destinationSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: destination.id })
      .getRawOne<{ sum: string }>();
    expect(BigInt(destinationSum!.sum)).toBe(0n);
  });

  it('retiene (flagged) una transferencia cuando hay demasiadas seguidas desde la misma cuenta', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'USD' }));

    const initialBalance = 10_000n;
    const smallAmount = 50n;

    // el fondeo (self-transfer) también cuenta para la regla de velocidad de "source"
    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: initialBalance.toString(),
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: initialBalance.toString(),
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({
        transactionId: seedTransaction.id,
        accountId: source.id,
        amountMinorUnits: initialBalance.toString(),
      }),
    );

    // 24 transferencias normales más (seed + estas 24 = 25 transacciones previas,
    // el umbral de velocidad configurado en FraudService)
    const normalTransfers = 24;
    for (let i = 0; i < normalTransfers; i++) {
      const res = await request(app.getHttpServer())
        .post('/transfers')
        .set('Idempotency-Key', randomUUID())
        .send({
          fromAccountId: source.id,
          toAccountId: destination.id,
          amountMinorUnits: smallAmount.toString(),
        });
      expect(res.body.status).toBe('completed');
    }

    // la siguiente (seed + 24 + esta = 25 previas) dispara la regla de velocidad
    const flaggedResponse = await request(app.getHttpServer())
      .post('/transfers')
      .set('Idempotency-Key', randomUUID())
      .send({
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinorUnits: smallAmount.toString(),
      });

    expect(flaggedResponse.status).toBe(201);
    expect(flaggedResponse.body.status).toBe('flagged');

    // el balance solo refleja las transferencias completadas, no la flagged
    const destinationSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: destination.id })
      .getRawOne<{ sum: string }>();
    expect(BigInt(destinationSum!.sum)).toBe(smallAmount * BigInt(normalTransfers));
  }, 15000);

  it('convierte el monto con la tasa de cambio en vivo cuando las cuentas tienen distinta moneda', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'EUR' }));

    const initialBalance = 10_000n;
    const amount = 1_000n;

    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: initialBalance.toString(),
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: initialBalance.toString(),
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({
        transactionId: seedTransaction.id,
        accountId: source.id,
        amountMinorUnits: initialBalance.toString(),
      }),
    );

    // se pide la misma tasa que usará internamente el endpoint (queda cacheada en Redis
    // 5 minutos), así el valor esperado no depende de que la tasa "en vivo" sea estable
    const fxService = app.get(FxService);
    const rate = await fxService.getRate('USD', 'EUR');
    const expectedConverted = fxService.convert(amount, rate);

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Idempotency-Key', randomUUID())
      .send({ fromAccountId: source.id, toAccountId: destination.id, amountMinorUnits: amount.toString() });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('completed');
    expect(response.body.currency).toBe('USD');
    expect(response.body.toCurrency).toBe('EUR');
    expect(BigInt(response.body.convertedAmountMinorUnits)).toBe(expectedConverted);

    const destinationSum = await entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id: destination.id })
      .getRawOne<{ sum: string }>();
    expect(BigInt(destinationSum!.sum)).toBe(expectedConverted);
  });
});
