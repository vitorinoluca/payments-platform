import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column()
  action: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
