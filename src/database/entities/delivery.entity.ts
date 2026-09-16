import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { UserEntity } from './user.entity';

@Entity()
@Index('IDX_DELIVERY_LOGICAL_ID', ['id'], { unique: true })
@Index('IDX_DELIVERY_IFOOD_ORDER_MERCHANT_UNIQUE', ['ifoodOrderId', 'ifoodMerchantId'], { unique: true })
@Index('IDX_DELIVERY_STATUS', ['status'])
@Index('IDX_DELIVERY_ESTABLISHMENT_CITY', ['establishmentCityId'])
@Index('IDX_DELIVERY_MOTOBOY', ['motoboyId'])
@Index('IDX_DELIVERY_ESTABLISHMENT', ['establishmentId'])
@Index('IDX_DELIVERY_CREATED_AT', ['createdAt'])
@Index('IDX_DELIVERY_FINISHED_AT', ['finishedAt'])
@Index('IDX_DELIVERY_ACTIVE_CITY_CREATED', ['isActive', 'establishmentCityId', 'createdAt'])
@Index('IDX_DELIVERY_ACTIVE_STATUS_CITY_FINISHED', [
  'isActive',
  'status',
  'establishmentCityId',
  'finishedAt',
])
@Index('IDX_DELIVERY_ACTIVE_MOTOBOY_STATUS_CREATED', [
  'isActive',
  'motoboyId',
  'status',
  'createdAt',
])
export class DeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column({ type: 'varchar', length: 64 })
  id: string;

  @Column()
  clientName: string;

  @Column()
  clientPhone: string;

  @Column({ nullable: true, type: 'text' })
  clientLocation?: string;

  @Column({ nullable: true, type: 'text' })
  clientAddress?: string;

  @Column({ nullable: true })
  addressComplement?: string;

  @Column({ nullable: true })
  addressReference?: string;

  @Column({ nullable: true })
  addressNeighborhood?: string;

  @Column({ nullable: true })
  addressCity?: string;

  @Column({ nullable: true })
  addressState?: string;

  @Column({ nullable: true })
  addressZipCode?: string;

  @Column({ nullable: true, type: 'double precision' })
  addressLatitude?: number;

  @Column({ nullable: true, type: 'double precision' })
  addressLongitude?: number;

  @Column({ nullable: true, type: 'text' })
  addressMapsUrl?: string;

  @Column({ type: 'varchar' })
  status: StatusDelivery;

  // Snapshots JSONB mantêm o formato esperado pelo frontend e pela integração iFood.
  @Column({ type: 'jsonb' })
  establishment: UserEntity;

  @Column({ type: 'jsonb', nullable: true })
  motoboy: UserEntity;

  // Colunas escalares tornam os filtros/índices eficientes no PostgreSQL.
  @Column({ type: 'varchar', length: 64 })
  establishmentId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  establishmentCityId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  motoboyId: string;

  @Column()
  value: string;

  @Column({ type: 'text', nullable: true })
  observation: string;

  @Column({ nullable: true, type: 'text' })
  destinationObservation?: string;

  @Column({ default: false })
  destinationObservationConfirmed?: boolean;

  @Column({ nullable: true })
  soda: string;

  @Column({ type: 'varchar' })
  payment: PaymentType;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  onCoursedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  collectedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  arrivedAtStoreAt?: Date;

  @Column({ nullable: true })
  ifoodStatus?: string;

  @Column({ nullable: true })
  externalStatus?: string;

  @Column({ nullable: true })
  logisticsStatus?: string;

  @Column({ nullable: true })
  ifoodOrderId?: string;

  @Column({ nullable: true })
  ifoodDisplayId?: string;

  @Column({ nullable: true })
  orderLocator?: string;

  @Column({ nullable: true })
  ifoodMerchantId?: string;

  @Column({ nullable: true })
  ifoodMerchantName?: string;

  @Column({ nullable: true, type: 'timestamptz' })
  ifoodImportedAt?: Date;

  @Column({ nullable: true })
  ifoodLastEventCode?: string;

  @Column({ nullable: true })
  ifoodLastEventFullCode?: string;

  @Column({ nullable: true, type: 'timestamptz' })
  ifoodConfirmedAt?: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  releasedAt?: Date;

  @Column({ nullable: true })
  releasedBy?: string;

  @Column({ nullable: true, type: 'timestamptz' })
  arrivedAtDestinationAt?: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  finishedAt: Date;

  @Column({ default: false })
  ifoodAssignDriverSynced?: boolean;

  @Column({ default: false })
  ifoodGoingToOriginSynced?: boolean;

  @Column({ default: false })
  ifoodArrivedAtOriginSynced?: boolean;

  @Column({ default: false })
  ifoodDispatchSynced?: boolean;

  @Column({ default: false })
  ifoodArrivedAtDestinationSynced?: boolean;
}
