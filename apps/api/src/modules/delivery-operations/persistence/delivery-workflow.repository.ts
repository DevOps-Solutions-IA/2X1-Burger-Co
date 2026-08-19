import {
  DeliveryWorkflowStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import type { DeliveryTransitionDecision } from '../delivery-workflow.policy';

export type DeliveryWorkflowJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DeliveryWorkflowJsonValue[]
  | { readonly [key: string]: DeliveryWorkflowJsonValue };

export interface DeliveryWorkflowSnapshot {
  orderTicketId: string;
  currentStatus: DeliveryWorkflowStatus | null;
  version: number;
  fulfillment: OrderTicketType;
  orderStatus: OrderTicketStatus;
  hasAssignedRider: boolean;
  assignedRiderId: string | null;
}

export interface PersistDeliveryWorkflowTransition {
  orderTicketId: string;
  expectedVersion: number;
  toStatus: DeliveryWorkflowStatus;
  idempotencyKey: string;
  actorId?: string | null;
  assignedRiderId?: string | null;
  reasonCode: string;
  sanitizedMetadata?: Readonly<Record<string, DeliveryWorkflowJsonValue>>;
}

export type DeliveryWorkflowTransitionResult = {
  state: 'APPLIED' | 'DETERMINISTIC_REPLAY' | 'NO_OP';
  orderTicketId: string;
  fromStatus: DeliveryWorkflowStatus | null;
  toStatus: DeliveryWorkflowStatus;
  version: number;
  idempotencyKey: string;
};

export type DeliveryWorkflowDecision = (
  snapshot: DeliveryWorkflowSnapshot,
) => DeliveryTransitionDecision;

export abstract class DeliveryWorkflowRepository {
  abstract transition(
    input: PersistDeliveryWorkflowTransition,
    decide: DeliveryWorkflowDecision,
  ): Promise<DeliveryWorkflowTransitionResult>;
}

export type DeliveryWorkflowErrorCode =
  | 'DELIVERY_WORKFLOW_NOT_FOUND'
  | 'DELIVERY_WORKFLOW_IDEMPOTENCY_CONFLICT'
  | 'STALE_DELIVERY_WORKFLOW_VERSION'
  | 'INVALID_DELIVERY_WORKFLOW_COMMAND'
  | 'ILLEGAL_TRANSITION'
  | 'NOT_DELIVERY_FULFILLMENT'
  | 'ORDER_NOT_READY'
  | 'RIDER_REQUIRED'
  | 'RIDER_MUST_BE_CLEARED'
  | 'RIDER_ALREADY_ASSIGNED';

export class DeliveryWorkflowError extends Error {
  constructor(public readonly code: DeliveryWorkflowErrorCode) {
    super(code);
    this.name = 'DeliveryWorkflowError';
  }
}
