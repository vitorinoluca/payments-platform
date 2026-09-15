import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { FraudService } from '../../fraud/fraud.service';
import { FxService } from '../../fx/fx.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { Account } from '../entities/account.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import { Transaction, TransactionStatus } from '../entities/transaction.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class TransfersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fraudService: FraudService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly webhooksService: WebhooksService,
    private readonly fxService: FxService,
    private readonly auditService: AuditService,
  ) {}

  async transfer(dto: CreateTransferDto, idempotencyKey: string): Promise<Transaction> {
    if (!idempotencyKey) {
      throw new BadRequestException('el header Idempotency-Key es obligatorio');
    }

    let amount: bigint;
    try {
      amount = BigInt(dto.amountMinorUnits);
    } catch {
      throw new BadRequestException('amountMinorUnits debe ser un entero');
    }
    if (amount <= 0n) {
      throw new BadRequestException('amountMinorUnits debe ser positivo');
    }
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('fromAccountId y toAccountId no pueden ser iguales');
    }

    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');

    // ponytail: simula el tiempo de procesamiento de un banco real; si hace falta un
    // estado "pending" visible mientras se procesa, pasar a un flujo async con polling/WS.
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1500));

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const idempotencyRepo = queryRunner.manager.getRepository(IdempotencyKey);

      // INSERT ... ON CONFLICT DO NOTHING: si otra transacción ya está procesando esta
      // misma key, Postgres bloquea este INSERT hasta que esa transacción termine.
      // Se usa SQL crudo con RETURNING porque el "identifiers" de TypeORM se arma a
      // partir de los valores provistos, no de si Postgres realmente insertó la fila.
      const insertedRows: Array<{ key: string }> = await queryRunner.query(
        `INSERT INTO idempotency_keys(key, "requestHash") VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [idempotencyKey, requestHash],
      );

      if (insertedRows.length === 0) {
        const existing = await idempotencyRepo.findOneBy({ key: idempotencyKey });
        if (existing!.requestHash !== requestHash) {
          throw new ConflictException('la Idempotency-Key ya fue usada con una petición distinta');
        }
        await queryRunner.commitTransaction();
        return existing!.responseBody as Transaction;
      }

      const accountRepo = queryRunner.manager.getRepository(Account);

      // se bloquean ambas cuentas en orden consistente (por id) para evitar deadlocks
      const accounts = await accountRepo
        .createQueryBuilder('account')
        .setLock('pessimistic_write')
        .where('account.id IN (:...ids)', { ids: [dto.fromAccountId, dto.toAccountId] })
        .orderBy('account.id', 'ASC')
        .getMany();

      const fromAccount = accounts.find((a) => a.id === dto.fromAccountId);
      const toAccount = accounts.find((a) => a.id === dto.toAccountId);
      if (!fromAccount || !toAccount) {
        throw new NotFoundException('cuenta origen o destino no existe');
      }

      const exchangeRate = await this.fxService.getRate(fromAccount.currency, toAccount.currency);
      const convertedAmount = this.fxService.convert(amount, exchangeRate);
      if (convertedAmount <= 0n) {
        throw new BadRequestException('el monto es demasiado chico para convertir entre estas monedas');
      }

      const transactionRepo = queryRunner.manager.getRepository(Transaction);

      const fraudResult = await this.fraudService.evaluate(queryRunner.manager, fromAccount.id, amount);

      if (fraudResult.flagged) {
        // se retiene la plata: no se generan ledger_entries, así que el balance no se
        // mueve hasta que alguien la revise (no hay endpoint de revisión todavía).
        const flaggedTransaction = await transactionRepo.save(
          transactionRepo.create({
            fromAccountId: fromAccount.id,
            toAccountId: toAccount.id,
            amountMinorUnits: amount.toString(),
            currency: fromAccount.currency,
            toCurrency: toAccount.currency,
            exchangeRate: exchangeRate.toString(),
            convertedAmountMinorUnits: convertedAmount.toString(),
            status: TransactionStatus.FLAGGED,
            fraudReason: fraudResult.reason ?? null,
          }),
        );

        await idempotencyRepo.update({ key: idempotencyKey }, { responseBody: flaggedTransaction });
        await queryRunner.commitTransaction();
        this.realtimeGateway.notifyTransfer(flaggedTransaction);
        void this.webhooksService.dispatch('transfer.updated', flaggedTransaction);
        void this.auditService.record('transfer.flagged', null, {
          transactionId: flaggedTransaction.id,
          fromAccountId: fromAccount.id,
          toAccountId: toAccount.id,
          amountMinorUnits: amount.toString(),
          fraudReason: fraudResult.reason,
        });
        return flaggedTransaction;
      }

      const entryRepo = queryRunner.manager.getRepository(LedgerEntry);
      const raw = await entryRepo
        .createQueryBuilder('entry')
        .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
        .where('entry.accountId = :id', { id: fromAccount.id })
        .getRawOne<{ sum: string }>();

      if (BigInt(raw!.sum) < amount) {
        throw new ConflictException('fondos insuficientes');
      }

      const transaction = await transactionRepo.save(
        transactionRepo.create({
          fromAccountId: fromAccount.id,
          toAccountId: toAccount.id,
          amountMinorUnits: amount.toString(),
          currency: fromAccount.currency,
          toCurrency: toAccount.currency,
          exchangeRate: exchangeRate.toString(),
          convertedAmountMinorUnits: convertedAmount.toString(),
          status: TransactionStatus.COMPLETED,
        }),
      );

      await entryRepo.save([
        entryRepo.create({
          transactionId: transaction.id,
          accountId: fromAccount.id,
          amountMinorUnits: (-amount).toString(),
        }),
        entryRepo.create({
          transactionId: transaction.id,
          accountId: toAccount.id,
          amountMinorUnits: convertedAmount.toString(),
        }),
      ]);

      await idempotencyRepo.update({ key: idempotencyKey }, { responseBody: transaction });

      await queryRunner.commitTransaction();
      this.realtimeGateway.notifyTransfer(transaction);
      void this.webhooksService.dispatch('transfer.updated', transaction);
      void this.auditService.record('transfer.completed', null, {
        transactionId: transaction.id,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        amountMinorUnits: amount.toString(),
      });
      return transaction;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
