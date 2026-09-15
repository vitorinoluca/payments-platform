import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Transaction } from './entities/transaction.entity';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly dataSource: DataSource) {}

  @Get(':id/balance')
  async balance(@Param('id') id: string) {
    const raw = await this.dataSource
      .getRepository(LedgerEntry)
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amountMinorUnits), 0)', 'sum')
      .where('entry.accountId = :id', { id })
      .getRawOne<{ sum: string }>();

    return { accountId: id, balanceMinorUnits: raw!.sum };
  }

  @Get(':id/transactions')
  transactions(@Param('id') id: string) {
    return this.dataSource
      .getRepository(Transaction)
      .createQueryBuilder('tx')
      .where('(tx.fromAccountId = :id OR tx.toAccountId = :id) AND tx.fromAccountId != tx.toAccountId', { id })
      .orderBy('tx.createdAt', 'DESC')
      .limit(20)
      .getMany();
  }
}
