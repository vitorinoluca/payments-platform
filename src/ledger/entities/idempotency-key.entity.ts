import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: unknown;

  @CreateDateColumn()
  createdAt: Date;
}
