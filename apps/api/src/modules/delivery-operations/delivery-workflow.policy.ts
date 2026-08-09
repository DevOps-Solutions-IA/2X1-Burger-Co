import {
  DeliveryWorkflowStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';

const LEGAL_TRANSITIONS: Readonly<Record<DeliveryWorkflowStatus, readonly DeliveryWorkflowStatus[]>> = {
  [DeliveryWorkflowStatus.PENDING_ASSIGNMENT]: [
    DeliveryWorkflowStatus.ASSIGNED,
    DeliveryWorkflowStatus.ISSUE,
  ],
  [DeliveryWorkflowStatus.ASSIGNED]: [
    DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
    DeliveryWorkflowStatus.IN_TRANSIT,
    DeliveryWorkflowStatus.ISSUE,
  ],
  [DeliveryWorkflowStatus.IN_TRANSIT]: [
    DeliveryWorkflowStatus.DELIVERED,
    DeliveryWorkflowStatus.ISSUE,
  ],
  [DeliveryWorkflowStatus.ISSUE]: [
    DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
    DeliveryWorkflowStatus.ASSIGNED,
    DeliveryWorkflowStatus.IN_TRANSIT,
  ],
  [DeliveryWorkflowStatus.DELIVERED]: [],
};

export type FulfillmentReadiness = 'NOT_READY' | 'READY' | 'SERVED';

export type DeliveryTransitionRejection =
  | 'ILLEGAL_TRANSITION'
  | 'NOT_DELIVERY_FULFILLMENT'
  | 'ORDER_NOT_READY'
  | 'RIDER_REQUIRED'
  | 'RIDER_MUST_BE_CLEARED';

export type DeliveryTransitionDecision =
  | { allowed: true; noOp: boolean }
  | { allowed: false; reason: DeliveryTransitionRejection };

export interface DeliveryTransitionContext {
  fulfillment: OrderTicketType;
  orderStatus: OrderTicketStatus;
  hasAssignedRider: boolean;
}

export const DELIVERY_ETA_AUTHORITY = 'DELIVERY_PRICING_SNAPSHOT' as const;

export type DeliveryEtaWriteSource =
  | typeof DELIVERY_ETA_AUTHORITY
  | 'CLIENT'
  | 'RIDER'
  | 'LIVE_LOCATION';

/**
 * SERVED is the persisted readiness state. READY is only a fulfillment-aware
 * projection for orders that still require pickup or dispatch.
 */
export function mapFulfillmentReadiness(
  fulfillment: OrderTicketType,
  status: OrderTicketStatus,
): FulfillmentReadiness {
  if (status !== OrderTicketStatus.SERVED) {
    return 'NOT_READY';
  }

  return fulfillment === OrderTicketType.DINE_IN ? 'SERVED' : 'READY';
}

export function canWriteDeliveryEta(source: DeliveryEtaWriteSource): boolean {
  return source === DELIVERY_ETA_AUTHORITY;
}

export class DeliveryWorkflowPolicy {
  legalTargets(current: DeliveryWorkflowStatus): readonly DeliveryWorkflowStatus[] {
    return LEGAL_TRANSITIONS[current];
  }

  evaluate(
    current: DeliveryWorkflowStatus,
    next: DeliveryWorkflowStatus,
    context: DeliveryTransitionContext,
  ): DeliveryTransitionDecision {
    if (context.fulfillment !== OrderTicketType.DELIVERY) {
      return { allowed: false, reason: 'NOT_DELIVERY_FULFILLMENT' };
    }

    if (current === next) {
      return { allowed: true, noOp: true };
    }

    if (!LEGAL_TRANSITIONS[current].includes(next)) {
      return { allowed: false, reason: 'ILLEGAL_TRANSITION' };
    }

    if (next === DeliveryWorkflowStatus.PENDING_ASSIGNMENT && context.hasAssignedRider) {
      return { allowed: false, reason: 'RIDER_MUST_BE_CLEARED' };
    }

    if (
      (next === DeliveryWorkflowStatus.ASSIGNED ||
        next === DeliveryWorkflowStatus.IN_TRANSIT ||
        next === DeliveryWorkflowStatus.DELIVERED) &&
      !context.hasAssignedRider
    ) {
      return { allowed: false, reason: 'RIDER_REQUIRED' };
    }

    if (
      next === DeliveryWorkflowStatus.IN_TRANSIT &&
      mapFulfillmentReadiness(context.fulfillment, context.orderStatus) !== 'READY'
    ) {
      return { allowed: false, reason: 'ORDER_NOT_READY' };
    }

    return { allowed: true, noOp: false };
  }
}
