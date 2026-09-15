import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { LedgerEntry } from './ledger-entry.entity';

export enum TransactionStatus {
  PENDING = 'pending',
  FLAGGED = 'flagged',
  COMPLETED = 'completed',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  fromAccountId: string;

  @Column({ type: 'uuid' })
  toAccountId: string;

  @Column({ type: 'bigint' })
  amountMinorUnits: string;

  @Column({ length: 3 })
  currency: string;

  // moneda de la cuenta destino; igual a "currency" salvo en transferencias multi-moneda
  @Column({ length: 3 })
  toCurrency: string;

  // tasa aplicada (currency -> toCurrency), '1' cuando ambas cuentas usan la misma moneda
  @Column({ type: 'numeric', precision: 20, scale: 10, default: '1' })
  exchangeRate: string;

  // monto ya convertido a toCurrency, es lo que efectivamente se acredita en la cuenta destino
  @Column({ type: 'bigint' })
  convertedAmountMinorUnits: string;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  // motivo si el fraud check la marcó (status queda en 'flagged'); null si pasó limpia
  @Column({ type: 'varchar', nullable: true })
  fraudReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => LedgerEntry, (entry) => entry.transaction)
  entries: LedgerEntry[];
}
