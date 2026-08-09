import { Module } from '@nestjs/common';
import { DeliveryWorkflowService } from './delivery-workflow.service';
import { DeliveryWorkflowRepository } from './persistence/delivery-workflow.repository';
import { PrismaDeliveryWorkflowRepository } from './persistence/prisma-delivery-workflow.repository';

@Module({
  providers: [
    DeliveryWorkflowService,
    PrismaDeliveryWorkflowRepository,
    { provide: DeliveryWorkflowRepository, useExisting: PrismaDeliveryWorkflowRepository },
  ],
  exports: [DeliveryWorkflowService],
})
export class DeliveryOperationsModule {}
