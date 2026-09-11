import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditLog } from './audit/entities/audit-log.entity';
import { AuthModule } from './auth/auth.module';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { User } from './auth/entities/user.entity';
import { Account } from './ledger/entities/account.entity';
import { IdempotencyKey } from './ledger/entities/idempotency-key.entity';
import { LedgerEntry } from './ledger/entities/ledger-entry.entity';
import { Transaction } from './ledger/entities/transaction.entity';
import { LedgerModule } from './ledger/ledger.module';
import { RedisModule } from './redis/redis.module';
import { WebhookEndpoint } from './webhooks/entities/webhook-endpoint.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    // límite general de la app; los endpoints sensibles a fuerza bruta (login/register)
    // tienen su propio límite más estricto vía @Throttle en el controller
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [Account, Transaction, LedgerEntry, IdempotencyKey, User, RefreshToken, WebhookEndpoint, AuditLog],
        uuidExtension: 'pgcrypto', // gen_random_uuid() viene incluido en Postgres 16, sin extensiones extra
        synchronize: true, // dev only, hasta que existan migraciones
        extra: { max: 30 }, // el pool default (10) se agota con locks pesimistas bajo concurrencia alta
      }),
    }),
    LedgerModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
