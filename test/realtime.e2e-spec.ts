import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { Account } from '../src/ledger/entities/account.entity';
import { LedgerEntry } from '../src/ledger/entities/ledger-entry.entity';
import { Transaction, TransactionStatus } from '../src/ledger/entities/transaction.entity';

describe('Realtime gateway (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    dataSource = moduleRef.get(DataSource);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('notifica por WebSocket cuando una transferencia se completa', async () => {
    const accountRepo = dataSource.getRepository(Account);
    const entryRepo = dataSource.getRepository(LedgerEntry);
    const transactionRepo = dataSource.getRepository(Transaction);

    const source = await accountRepo.save(accountRepo.create({ currency: 'USD' }));
    const destination = await accountRepo.save(accountRepo.create({ currency: 'USD' }));

    const seedTransaction = await transactionRepo.save(
      transactionRepo.create({
        fromAccountId: source.id,
        toAccountId: source.id,
        amountMinorUnits: '1000',
        currency: 'USD',
        toCurrency: 'USD',
        convertedAmountMinorUnits: '1000',
        status: TransactionStatus.COMPLETED,
      }),
    );
    await entryRepo.save(
      entryRepo.create({ transactionId: seedTransaction.id, accountId: source.id, amountMinorUnits: '1000' }),
    );

    const client: Socket = io(baseUrl, { transports: ['websocket'] });
    try {
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });

      client.emit('subscribe', { accountId: destination.id });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const eventReceived = new Promise((resolve) => client.once('transfer.updated', resolve));

      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Idempotency-Key', randomUUID())
        .send({ fromAccountId: source.id, toAccountId: destination.id, amountMinorUnits: '200' });

      expect(response.status).toBe(201);

      const event = await eventReceived;
      expect(event).toMatchObject({
        id: response.body.id,
        fromAccountId: source.id,
        toAccountId: destination.id,
        status: 'completed',
      });
    } finally {
      client.close();
    }
  });
});
