import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Account } from './account.entity';
import { Transaction } from './transaction.entity';

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.entries)
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Column({ type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'uuid' })
  accountId: string;

  // negativo = débito, positivo = crédito
  @Column({ type: 'bigint' })
  amountMinorUnits: string;

  @CreateDateColumn()
  createdAt: Date;
}
