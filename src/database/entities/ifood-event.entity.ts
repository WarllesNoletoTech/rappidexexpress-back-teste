import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index('IDX_IFOOD_EVENT_EVENT_ID', ['eventId'], { unique: true })
@Index('IDX_IFOOD_EVENT_ORDER_PROCESSED', ['orderId', 'processedAt'])
@Index('IDX_IFOOD_EVENT_MERCHANT_PROCESSED', ['merchantId', 'processedAt'])
@Index('IDX_IFOOD_EVENT_ACK_PROCESSED', ['acknowledged', 'processedAt'])
export class IfoodEventEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column()
  eventId: string;

  @Column({ nullable: true })
  orderId: string;

  @Column({ nullable: true })
  merchantId: string;

  @Column({ nullable: true })
  code: string;

  @Column({ nullable: true })
  fullCode: string;

  @Column({ nullable: true })
  salesChannel?: string;

  @Column({ nullable: true })
  createdAt?: string;

  @Column({ type: 'timestamptz' })
  processedAt: Date;

  @Column({ default: false })
  acknowledged: boolean;
}
