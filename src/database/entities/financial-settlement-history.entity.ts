import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index('IDX_FIN_SETTLEMENT_ESTABLISHMENT_PERIOD', [
  'establishmentId',
  'periodStart',
  'periodEnd',
])
export class FinancialSettlementHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  establishmentId: string;

  @Column()
  establishmentName: string;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  cityId?: string;

  @Column({ nullable: true })
  cityName?: string;

  @Column({ type: 'timestamptz' })
  periodStart: Date;

  @Column({ type: 'timestamptz' })
  periodEnd: Date;

  @Column({ type: 'integer' })
  deliveriesCount: number;

  @Column({ type: 'double precision' })
  deliveryFeeValue: number;

  @Column({ type: 'double precision' })
  total: number;

  @Column({ nullable: true })
  includeMonthlyFee?: boolean;

  @Column({ nullable: true, type: 'double precision' })
  monthlyFeeValue?: number;

  @Column({ nullable: true })
  pixKey: string;

  @Column({ nullable: true })
  whatsappPhone: string;

  @Column({ nullable: true })
  whatsappAdminPhone?: string;

  @Column({ nullable: true })
  whatsappPhoneNumberId?: string;

  @Column()
  filename: string;

  @Column({ type: 'timestamptz' })
  sentAt: Date;

  @Column({ type: 'varchar' })
  status:
    | 'PDF_GERADO'
    | 'WHATSAPP_ABERTO'
    | 'ENVIO_MANUAL'
    | 'enviado'
    | 'erro'
    | 'pendente';

  @Column({ nullable: true, type: 'text' })
  errorMessage?: string;
}
