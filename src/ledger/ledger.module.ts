import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FraudModule } from '../fraud/fraud.module';
import { FxModule } from '../fx/fx.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { Account } from './entities/account.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Transaction } from './entities/transaction.entity';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, Transaction, LedgerEntry, IdempotencyKey]),
    FraudModule,
    RealtimeModule,
    WebhooksModule,
    FxModule,
    AuditModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TypeOrmModule],
})
export class LedgerModule {}
