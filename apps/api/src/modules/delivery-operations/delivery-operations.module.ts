import { Module } from '@nestjs/common';
import { DeliveryWorkflowService } from './delivery-workflow.service';
import { DeliveryWorkflowRepository } from './persistence/delivery-workflow.repository';
import { PrismaDeliveryWorkflowRepository } from './persistence/prisma-delivery-workflow.repository';
import { DeliveryAssignmentCommandHandler } from './production/delivery-assignment-command.handler';

@Module({
  providers: [
    DeliveryWorkflowService,
    PrismaDeliveryWorkflowRepository,
    { provide: DeliveryWorkflowRepository, useExisting: PrismaDeliveryWorkflowRepository },
    DeliveryAssignmentCommandHandler,
  ],
  exports: [DeliveryWorkflowService, DeliveryAssignmentCommandHandler],
})
export class DeliveryOperationsModule {}
