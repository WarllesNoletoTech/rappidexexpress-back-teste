import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity()
@Index('IDX_LOG_LOGICAL_ID', ['id'], { unique: true })
export class LogEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column({ type: 'varchar', length: 64 })
  id: string;

  @Column()
  where: string;

  @Column()
  type: string;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'jsonb' })
  user: UserEntity;

  @Column()
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
