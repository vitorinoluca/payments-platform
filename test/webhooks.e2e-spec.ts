import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac, randomUUID } from 'crypto';
import * as http from 'http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Account } from '../src/ledger/entities/account.entity';
import { LedgerEntry } from '../src/ledger/entities/ledger-entry.entity';
import { Transaction, TransactionStatus } from '../src/ledger/entities/transaction.entity';
import { WebhookEndpoint } from '../src/webhooks/entities/webhook-endpoint.entity';

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('entrega un webhook firmado con HMAC cuando se completa una transferencia', async () => {
    const receivedRequests: Array<{ body: string; signature: string }> = [];

    const receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        receivedRequests.push({
          body: Buffer.concat(chunks).toString('utf8'),
          signature: req.headers['x-webhook-signature'] as string,
        });
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    const receiverAddress = receiver.address();
    const receiverUrl = `http://127.0.0.1:${(receiverAddress as any).port}/hook`;

    try {
      const registerResponse = await request(app.getHttpServer()).post('/webhooks').send({ url: receiverUrl });
      expect(registerResponse.status).toBe(201);
      const { secret } = registerResponse.body;

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

      const transferResponse = await request(app.getHttpServer())
        .post('/transfers')
        .set('Idempotency-Key', randomUUID())
        .send({ fromAccountId: source.id, toAccountId: destination.id, amountMinorUnits: '150' });

      expect(transferResponse.status).toBe(201);

      // el dispatch es fire-and-forget, se espera a que llegue
      await new Promise((resolve) => setTimeout(resolve, 300));

      // el endpoint es global, así que puede recibir también eventos de otras
      // transferencias que corren en paralelo en otros archivos e2e; se filtra
      // por el id propio de esta transferencia para no depender de esa carrera
      const received = receivedRequests.find((r) => JSON.parse(r.body).data.id === transferResponse.body.id);
      expect(received).toBeDefined();

      const expectedSignature = createHmac('sha256', secret).update(received!.body).digest('hex');
      expect(received!.signature).toBe(expectedSignature);

      const payload = JSON.parse(received!.body);
      expect(payload).toMatchObject({
        event: 'transfer.updated',
        data: { id: transferResponse.body.id, status: 'completed' },
      });
    } finally {
      receiver.close();
      await dataSource.getRepository(WebhookEndpoint).delete({ url: receiverUrl });
    }
  });
});
