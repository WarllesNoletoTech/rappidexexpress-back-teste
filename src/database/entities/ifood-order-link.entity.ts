import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(
  'IDX_IFOOD_ORDER_LINK_ORDER_MERCHANT_UNIQUE',
  ['ifoodOrderId', 'merchantId'],
  { unique: true },
)
@Index('IDX_IFOOD_ORDER_LINK_DELIVERY', ['deliveryId'])
@Index('IDX_IFOOD_ORDER_LINK_SHOPKEEPER_CREATED', ['shopkeeperId', 'createdAt'])
export class IfoodOrderLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column()
  ifoodOrderId: string;

  @Column({ nullable: true })
  ifoodDisplayId: string;

  @Column()
  merchantId: string;

  @Column({ nullable: true })
  merchantName?: string;

  @Column({ type: 'varchar', length: 64 })
  deliveryId: string;

  @Column({ type: 'varchar', length: 64 })
  shopkeeperId: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
