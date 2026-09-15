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
        // en Vercel cada cold start crea un DataSource nuevo: re-sincronizar el schema en
        // cada uno gasta horas de cómputo de Neon gratis y arriesga romper el boot (ya pasó).
        // El schema ya está aplicado; solo hace falta prender esto localmente al cambiar entities.
        synchronize: !process.env.VERCEL,
        // pool chico en serverless: cada instancia de función puede abrir hasta `max` conexiones,
        // y Fluid Compute corre varias instancias en paralelo — 30 por instancia agota rápido el
        // límite de conexiones de Neon. Local (un solo proceso) puede permitirse más.
        extra: { max: process.env.VERCEL ? 5 : 30 },
      }),
    }),
    LedgerModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
