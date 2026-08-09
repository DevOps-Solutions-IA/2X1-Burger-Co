import {
  DeliveryWorkflowStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import {
  canWriteDeliveryEta,
  DeliveryWorkflowPolicy,
  mapFulfillmentReadiness,
} from './delivery-workflow.policy';

describe('DeliveryWorkflowPolicy', () => {
  const policy = new DeliveryWorkflowPolicy();
  const readyDelivery = {
    fulfillment: OrderTicketType.DELIVERY,
    orderStatus: OrderTicketStatus.SERVED,
    hasAssignedRider: true,
  };

  it('allows only the forward delivery path and explicit issue detours', () => {
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        DeliveryWorkflowStatus.ASSIGNED,
        readyDelivery,
      ),
    ).toEqual({ allowed: true, noOp: false });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.ASSIGNED,
        DeliveryWorkflowStatus.IN_TRANSIT,
        readyDelivery,
      ),
    ).toEqual({ allowed: true, noOp: false });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.IN_TRANSIT,
        DeliveryWorkflowStatus.DELIVERED,
        readyDelivery,
      ),
    ).toEqual({ allowed: true, noOp: false });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.ASSIGNED,
        DeliveryWorkflowStatus.ISSUE,
        readyDelivery,
      ),
    ).toEqual({ allowed: true, noOp: false });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.ISSUE,
        DeliveryWorkflowStatus.IN_TRANSIT,
        readyDelivery,
      ),
    ).toEqual({ allowed: true, noOp: false });
  });

  it('rejects skips, regressions, and transitions out of delivered', () => {
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        DeliveryWorkflowStatus.IN_TRANSIT,
        readyDelivery,
      ),
    ).toEqual({ allowed: false, reason: 'ILLEGAL_TRANSITION' });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.IN_TRANSIT,
        DeliveryWorkflowStatus.ASSIGNED,
        readyDelivery,
      ),
    ).toEqual({ allowed: false, reason: 'ILLEGAL_TRANSITION' });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.DELIVERED,
        DeliveryWorkflowStatus.IN_TRANSIT,
        readyDelivery,
      ),
    ).toEqual({ allowed: false, reason: 'ILLEGAL_TRANSITION' });
  });

  it('requires a rider and persisted SERVED readiness before dispatch', () => {
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.ASSIGNED,
        DeliveryWorkflowStatus.IN_TRANSIT,
        { ...readyDelivery, hasAssignedRider: false },
      ),
    ).toEqual({ allowed: false, reason: 'RIDER_REQUIRED' });
    expect(
      policy.evaluate(
        DeliveryWorkflowStatus.ASSIGNED,
        DeliveryWorkflowStatus.IN_TRANSIT,
        { ...readyDelivery, orderStatus: OrderTicketStatus.IN_PREPARATION },
      ),
    ).toEqual({ allowed: false, reason: 'ORDER_NOT_READY' });
  });

  it('projects SERVED as READY according to fulfillment without inventing a stored state', () => {
    expect(mapFulfillmentReadiness(OrderTicketType.DELIVERY, OrderTicketStatus.SERVED)).toBe('READY');
    expect(mapFulfillmentReadiness(OrderTicketType.TAKEAWAY, OrderTicketStatus.SERVED)).toBe('READY');
    expect(mapFulfillmentReadiness(OrderTicketType.COUNTER, OrderTicketStatus.SERVED)).toBe('READY');
    expect(mapFulfillmentReadiness(OrderTicketType.DINE_IN, OrderTicketStatus.SERVED)).toBe('SERVED');
    expect(mapFulfillmentReadiness(OrderTicketType.DELIVERY, OrderTicketStatus.IN_PREPARATION)).toBe(
      'NOT_READY',
    );
  });

  it('keeps ETA writes under the delivery pricing snapshot authority', () => {
    expect(canWriteDeliveryEta('DELIVERY_PRICING_SNAPSHOT')).toBe(true);
    expect(canWriteDeliveryEta('LIVE_LOCATION')).toBe(false);
    expect(canWriteDeliveryEta('RIDER')).toBe(false);
    expect(canWriteDeliveryEta('CLIENT')).toBe(false);
  });
});
