import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity()
@Index('IDX_CITY_NAME_STATE', ['name', 'state'])
export class CityEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column()
  name: string;

  @Column({ nullable: false })
  state?: string;

  @Column({ nullable: true, type: 'text' })
  clientWhatsappMessage?: string;

  @Column({ nullable: true })
  deliveryValue?: string;

  @Column({ nullable: true, type: 'double precision' })
  deliveryFeeValue?: number;

  @Column({ nullable: true, type: 'double precision' })
  monthlyFeeValue?: number;

  @Column({ nullable: true })
  pixKey?: string;

  @Column({ nullable: true })
  adminWhatsapp?: string;

  @Column({ nullable: true })
  whatsappPhoneNumberId?: string;

  @Column({ nullable: true, type: 'text' })
  whatsappCloudToken?: string;
}
