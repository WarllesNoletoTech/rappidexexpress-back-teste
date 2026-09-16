import { Module } from '@nestjs/common';
import { FinancialSettlementController } from './financial-settlement.controller';
import { FinancialSettlementService } from './financial-settlement.service';

@Module({
  controllers: [FinancialSettlementController],
  providers: [FinancialSettlementService],
})
export class FinancialSettlementModule {}
