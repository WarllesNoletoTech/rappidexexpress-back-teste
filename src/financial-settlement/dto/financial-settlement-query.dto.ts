import { IsOptional, IsString } from 'class-validator';

export class FinancialSettlementQueryDto {
  @IsString()
  establishmentId: string;

  @IsString()
  createdIn: string;

  @IsString()
  createdUntil: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  includeMonthlyFee?: string;
}
