import { Expose, plainToClass } from 'class-transformer';
import {
  UserType,
  Permissions as UserPermissions,
} from '../../shared/constants/enums.constants';
import { UserEntity } from '../../database/entities/user.entity';

export class UserResult {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  phone: string;

  @Expose()
  user: string;

  @Expose()
  profileImage?: string;

  @Expose()
  location?: string;

  @Expose()
  type: UserType;

  @Expose()
  pix: string;

  @Expose()
  permission: UserPermissions;

  @Expose()
  isActive: boolean;

  @Expose()
  blocked: boolean;

  @Expose()
  blockedReason?: string;

  @Expose()
  blockedAt?: Date;

  @Expose()
  blockedBySystem: boolean;

  @Expose()
  unblockedAt?: Date;

  @Expose()
  unblockedBy?: string;

  @Expose()
  cityId: string;
  
  @Expose()
  useIfoodIntegration: boolean;

  @Expose()
  usesExternalIfoodPdv: boolean;

  @Expose()
  ifoodWithoutPreparationTime: boolean;

  @Expose()
  ifoodMerchantId?: string;
  @Expose()
  ifoodMerchants?: Array<{
    merchantId: string;
    name: string;
    enabled: boolean;
    pickupAddress?: string;
  }>;

  @Expose()
  ifoodClientId?: string;

  @Expose()
  ifoodOrdersReleased: number;

  @Expose()
  ifoodOrdersUsed: number;

  @Expose()
  ifoodOrdersAvailable: number;

  public static fromEntity(user: UserEntity) {
    return plainToClass<UserResult, UserResult>(UserResult, {
      ...user,
      usesExternalIfoodPdv: Boolean(user?.usesExternalIfoodPdv),
      ifoodWithoutPreparationTime: Boolean(user?.ifoodWithoutPreparationTime),
      blocked: Boolean(user?.blocked),
      blockedBySystem: Boolean(user?.blockedBySystem),
    } as UserResult, {
      excludeExtraneousValues: true,
    });
  }
}
