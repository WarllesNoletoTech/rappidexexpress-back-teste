import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { Permissions, UserType } from '../../shared/constants/enums.constants';

export type IfoodMerchantConfig = {
  merchantId: string;
  name: string;
  enabled: boolean;
  pickupAddress?: string;
};

@Entity()
export class UserEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ unique: true })
  user: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ nullable: true })
  location: string;

  @Column({ type: 'enum', enum: UserType })
  type: UserType;

  @Column({ type: 'enum', enum: Permissions })
  permission: Permissions;

  @Column()
  pix: string;

  @Column()
  cityId: string;

  @Column()
  isActive: boolean;

  @Column({ default: false })
  blocked: boolean;

  @Column({ nullable: true })
  blockedReason?: string;

  @Column({ nullable: true })
  blockedAt?: Date;

  @Column({ default: false })
  blockedBySystem: boolean;

  @Column({ nullable: true })
  unblockedAt?: Date;

  @Column({ nullable: true })
  unblockedBy?: string;

  @Column()
  notification: {
    subscriptionId: string;
    // endpoint: string;
    // keys: {
    //   auth: string;
    //   p256dh: string;
    // };
  };

  @Column()
  token: string;

  @Column({ default: false })
  useIfoodIntegration: boolean;

  @Column({ default: false })
  usesExternalIfoodPdv: boolean;

  @Column({ default: false })
  ifoodWithoutPreparationTime: boolean;

  @Column({ nullable: true })
  ifoodMerchantId?: string;

  @Column({ nullable: true })
  ifoodMerchants?: IfoodMerchantConfig[];

  @Column({ nullable: true })
  ifoodClientId?: string;

  @Column({ nullable: true })
  ifoodClientSecret?: string;

  @Column({ default: 0 })
  ifoodOrdersReleased: number;

  @Column({ default: 0 })
  ifoodOrdersUsed: number;

  @Column({ default: 0 })
  ifoodOrdersAvailable: number;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column()
  updatedAt: Date;
}
