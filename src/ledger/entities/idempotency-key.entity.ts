import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;

  // sha256 del request body; si la misma key llega con un body distinto, es un error del
  // cliente (key reusada), no un reintento legítimo
  @Column()
  requestHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
