import { Module } from '@nestjs/common';
import { CashReconciliationService } from '../cash-register/cash-reconciliation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, CashReconciliationService],
  exports: [ReportsService],
})
export class ReportsModule {}
