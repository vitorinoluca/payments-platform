import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 3 })
  currency: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
