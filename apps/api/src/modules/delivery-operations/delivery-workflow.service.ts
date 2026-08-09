import { Injectable } from '@nestjs/common';
import { DeliveryWorkflowStatus } from '@prisma/client';
import { DeliveryWorkflowPolicy } from './delivery-workflow.policy';
import {
  DeliveryWorkflowError,
  DeliveryWorkflowRepository,
  type DeliveryWorkflowJsonValue,
  type DeliveryWorkflowTransitionResult,
} from './persistence/delivery-workflow.repository';

export interface TransitionDeliveryWorkflowCommand {
  orderTicketId: string;
  expectedVersion: number;
  toStatus: DeliveryWorkflowStatus;
  idempotencyKey: string;
  actorId?: string | null;
  assignedRiderId?: string | null;
  reasonCode: string;
  sanitizedMetadata?: Readonly<Record<string, DeliveryWorkflowJsonValue>>;
}

@Injectable()
export class DeliveryWorkflowService {
  private readonly policy = new DeliveryWorkflowPolicy();

  constructor(private readonly repository: DeliveryWorkflowRepository) {}

  transition(
    command: TransitionDeliveryWorkflowCommand,
  ): Promise<DeliveryWorkflowTransitionResult> {
    this.assertCommand(command);
    return this.repository.transition(command, (snapshot) => {
      const current = snapshot.currentStatus ?? DeliveryWorkflowStatus.PENDING_ASSIGNMENT;
      return this.policy.evaluate(current, command.toStatus, {
        fulfillment: snapshot.fulfillment,
        orderStatus: snapshot.orderStatus,
        hasAssignedRider: command.assignedRiderId === undefined
          ? snapshot.hasAssignedRider
          : command.assignedRiderId !== null,
      });
    });
  }

  private assertCommand(command: TransitionDeliveryWorkflowCommand): void {
    const validKey = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/.test(command.idempotencyKey);
    const validReason =
      command.reasonCode.length > 0 && command.reasonCode.length <= 128;
    const validMetadata =
      command.sanitizedMetadata === undefined ||
      JSON.stringify(command.sanitizedMetadata).length <= 4_096;
    if (
      !command.orderTicketId ||
      !Number.isInteger(command.expectedVersion) ||
      command.expectedVersion < 0 ||
      !validKey ||
      !validReason ||
      !validMetadata
    ) {
      throw new DeliveryWorkflowError('INVALID_DELIVERY_WORKFLOW_COMMAND');
    }
  }
}
