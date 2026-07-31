import { Injectable } from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { Transaction } from '../ledger/entities/transaction.entity';

export interface FraudCheckResult {
  flagged: boolean;
  reason?: string;
}

const HIGH_AMOUNT_THRESHOLD = 1_000_000n;
const VELOCITY_WINDOW_MS = 60_000;
const VELOCITY_MAX_TRANSFERS = 25;

@Injectable()
export class FraudService {
  async evaluate(manager: EntityManager, fromAccountId: string, amount: bigint): Promise<FraudCheckResult> {
    if (amount >= HIGH_AMOUNT_THRESHOLD) {
      return { flagged: true, reason: 'monto por encima del umbral permitido' };
    }

    const windowStart = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const recentTransfers = await manager.getRepository(Transaction).count({
      where: { fromAccountId, createdAt: MoreThan(windowStart) },
    });

    if (recentTransfers >= VELOCITY_MAX_TRANSFERS) {
      return { flagged: true, reason: 'demasiadas transferencias en poco tiempo desde la misma cuenta' };
    }

    return { flagged: false };
  }
}
