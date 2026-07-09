import { Module } from '@nestjs/common';
import { CashRegisterController } from './cash-register.controller';
import { CashReconciliationService } from './cash-reconciliation.service';
import { CashRegisterService } from './cash-register.service';
import { ReportsModule } from '../reports/reports.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [ReportsModule, WhatsappModule],
  controllers: [CashRegisterController],
  providers: [CashRegisterService, CashReconciliationService],
  exports: [CashRegisterService, CashReconciliationService],
})
export class CashRegisterModule {}
