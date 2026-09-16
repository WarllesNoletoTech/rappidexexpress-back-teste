import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintNumberTransformer = {
  to: (value?: number | string | null) => value ?? 0,
  from: (value?: number | string | null) => Number(value ?? 0),
};

export type IfoodCreditOperationType = 'ADD' | 'REMOVE' | 'CONSUME' | 'REFUND';

@Entity()
@Index('IDX_IFOOD_CREDIT_LOGICAL_ID', ['id'], { unique: true })
@Index('IDX_IFOOD_CREDIT_COMPANY_CREATED', ['companyId', 'createdAt'])
export class IfoodCreditHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  companyId: string;

  @Column({ type: 'varchar' })
  operationType: IfoodCreditOperationType;

  @Column({ type: 'numeric', transformer: bigintNumberTransformer })
  amount: number;

  @Column({ type: 'numeric', transformer: bigintNumberTransformer })
  releasedAfterOperation: number;

  @Column({ type: 'numeric', transformer: bigintNumberTransformer })
  usedAfterOperation: number;

  @Column({ type: 'numeric', transformer: bigintNumberTransformer })
  availableAfterOperation: number;

  @Column({ nullable: true })
  performedBy?: string;

  @Column({ nullable: true })
  orderId?: string;

  @Column({ nullable: true, type: 'text' })
  reason?: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
