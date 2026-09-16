import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Permissions, UserType } from '../../shared/constants/enums.constants';

const bigintNumberTransformer = {
  to: (value?: number | string | null) => value ?? 0,
  from: (value?: number | string | null) => Number(value ?? 0),
};

export type IfoodMerchantConfig = {
  merchantId: string;
  name: string;
  enabled: boolean;
  pickupAddress?: string;
};

@Entity()
@Index('IDX_USER_LOGICAL_ID', ['id'], { unique: true })
@Index('IDX_USER_USERNAME', ['user'], { unique: true })
@Index('IDX_USER_CITY_TYPE_ACTIVE', ['cityId', 'type', 'isActive'])
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  internalId: string;

  @Column({ type: 'varchar', length: 64 })
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column()
  user: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ nullable: true, type: 'text' })
  location: string;

  @Column({ type: 'varchar' })
  type: UserType;

  @Column({ type: 'varchar' })
  permission: Permissions;

  @Column({ nullable: true })
  pix: string;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  cityId: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  blocked: boolean;

  @Column({ nullable: true, type: 'text' })
  blockedReason?: string;

  @Column({ nullable: true, type: 'timestamptz' })
  blockedAt?: Date;

  @Column({ default: false })
  blockedBySystem: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  unblockedAt?: Date;

  @Column({ nullable: true })
  unblockedBy?: string;

  @Column({ nullable: true, type: 'jsonb' })
  notification: {
    subscriptionId: string;
  };

  @Column({ nullable: true, type: 'text' })
  token: string;

  @Column({ default: false })
  useIfoodIntegration: boolean;

  @Column({ default: false })
  usesExternalIfoodPdv: boolean;

  @Column({ default: false })
  ifoodWithoutPreparationTime: boolean;

  @Column({ nullable: true })
  ifoodMerchantId?: string;

  @Column({ nullable: true, type: 'jsonb' })
  ifoodMerchants?: IfoodMerchantConfig[];

  @Column({ nullable: true, type: 'text' })
  ifoodClientId?: string;

  @Column({ nullable: true, type: 'text' })
  ifoodClientSecret?: string;

  @Column({ default: 0, type: 'bigint', transformer: bigintNumberTransformer })
  ifoodOrdersReleased: number;

  @Column({ default: 0, type: 'bigint', transformer: bigintNumberTransformer })
  ifoodOrdersUsed: number;

  @Column({ default: 0, type: 'bigint', transformer: bigintNumberTransformer })
  ifoodOrdersAvailable: number;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  updatedAt: Date;
}
