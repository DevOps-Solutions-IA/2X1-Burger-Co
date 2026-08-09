import { Module } from '@nestjs/common';
import { CashRegisterController } from './cash-register.controller';
import { CashReconciliationService } from './cash-reconciliation.service';
import { CashRegisterService } from './cash-register.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [CashRegisterController],
  providers: [CashRegisterService, CashReconciliationService],
  exports: [CashRegisterService, CashReconciliationService],
})
export class CashRegisterModule {}
