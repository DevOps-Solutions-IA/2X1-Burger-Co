import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import type { CommandRecord } from '../../secure-command/secure-command.types';
import { DeliveryWorkflowError } from '../persistence/delivery-workflow.repository';
import { DeliveryAssignmentCommandHandler } from './delivery-assignment-command.handler';

const ORDER_ID = 'order-aaaaaaaaaaaa';
const RIDER_ID = 'rider-bbbbbbbbbbbb';

function hashCanonical(value: Record<string, string>): string {
  const canonical = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function payloadHashFor(expectedVersion: string, commandType = 'SOFIA_ASSIGN_DELIVERY') {
  return hashCanonical({
    commandType,
    orderTicketId: ORDER_ID,
    riderId: RIDER_ID,
    expectedVersion,
  });
}

function command(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: 'cmd-1',
    commandType: 'SOFIA_ASSIGN_DELIVERY',
    scope: 'sofia',
    idempotencyKey: 'hashed-idempotency-key',
    status: 'EXECUTING',
    actorId: 'sofia-system-actor',
    actorType: 'SYSTEM',
    actorRoles: ['system'],
    source: 'sofia_agent',
    targetType: 'DELIVERY_WORKFLOW',
    targetId: `${ORDER_ID}:${RIDER_ID}`,
    expectedVersion: '0',
    payloadHash: payloadHashFor('0'),
    policyHash: 'policy-hash',
    releaseVersion: 'test',
    correlationId: null,
    traceId: null,
    claimOwnerHash: null,
    leaseExpiresAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    claimedAt: new Date(),
    completedAt: null,
    failureClass: null,
    failureCode: null,
    retryable: false,
    version: 1,
    result: null,
    ...overrides,
  };
}

function harness(overrides: {
  order?: Record<string, unknown> | null;
  rider?: Record<string, unknown> | null;
  transition?: jest.Mock;
} = {}) {
  const order = overrides.order === undefined
    ? {
        id: ORDER_ID,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        deliveryWorkflowVersion: 0,
        assignedRiderId: null,
      }
    : overrides.order;
  const rider = overrides.rider === undefined
    ? {
        id: RIDER_ID,
        isActive: true,
        roles: [{ role: { name: 'delivery' } }],
      }
    : overrides.rider;
  const prisma = {
    orderTicket: { findUnique: jest.fn().mockResolvedValue(order) },
    user: { findUnique: jest.fn().mockResolvedValue(rider) },
  };
  const deliveryWorkflow = {
    transition:
      overrides.transition ??
      jest.fn().mockResolvedValue({
        state: 'APPLIED',
        orderTicketId: ORDER_ID,
        fromStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        version: 1,
        idempotencyKey: 'delivery:sofia-assign:order:0:rider',
      }),
  };
  const handler = new DeliveryAssignmentCommandHandler(prisma as never, deliveryWorkflow as never);
  return { handler, prisma, deliveryWorkflow };
}

describe('DeliveryAssignmentCommandHandler', () => {
  it('rejects any command type other than SOFIA_ASSIGN_DELIVERY', async () => {
    const { handler } = harness();
    await expect(handler.execute(command({ commandType: 'SOFIA_CREATE_ORDER' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a malformed target id', async () => {
    const { handler } = harness();
    await expect(handler.execute(command({ targetId: 'not-a-composite-id' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a payload hash that does not match the trusted target fields', async () => {
    const { handler } = harness();
    await expect(
      handler.execute(command({ payloadHash: 'tampered-hash' })),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_ASSIGNMENT_PAYLOAD_BINDING_INVALID' } });
  });

  it('assigns the rider by delegating to the existing DeliveryWorkflowService authority', async () => {
    const { handler, deliveryWorkflow } = harness();
    const result = await handler.execute(command());
    expect(deliveryWorkflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderTicketId: ORDER_ID,
        expectedVersion: 0,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        assignedRiderId: RIDER_ID,
        actorId: 'sofia-system-actor',
        idempotencyKey: `delivery:sofia-assign:${ORDER_ID}:0:${RIDER_ID}`,
      }),
    );
    expect(result).toMatchObject({
      resultCode: 'SOFIA_DELIVERY_ASSIGNED',
      domainReferenceIds: [ORDER_ID],
    });
  });

  it('rejects when the order ticket cannot be found', async () => {
    const { handler } = harness({ order: null });
    await expect(handler.execute(command())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects orders that are not delivery fulfillment (no cross-domain mutation)', async () => {
    const { handler, deliveryWorkflow } = harness({
      order: {
        id: ORDER_ID,
        type: OrderTicketType.TAKEAWAY,
        status: OrderTicketStatus.SERVED,
        deliveryWorkflowVersion: 0,
        assignedRiderId: null,
      },
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_NOT_DELIVERY_FULFILLMENT' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('rejects orders already closed (PAID/CANCELLED)', async () => {
    const { handler, deliveryWorkflow } = harness({
      order: {
        id: ORDER_ID,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.PAID,
        deliveryWorkflowVersion: 0,
        assignedRiderId: null,
      },
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_ORDER_CLOSED' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version before touching the workflow authority (concurrency guard)', async () => {
    const { handler, deliveryWorkflow } = harness({
      order: {
        id: ORDER_ID,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        deliveryWorkflowVersion: 3,
        assignedRiderId: null,
      },
    });
    await expect(handler.execute(command({ expectedVersion: '0', payloadHash: payloadHashFor('0') }))).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_VERSION_CONFLICT' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('rejects an inactive rider', async () => {
    const { handler, deliveryWorkflow } = harness({
      rider: { id: RIDER_ID, isActive: false, roles: [{ role: { name: 'delivery' } }] },
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_RIDER_INVALID' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('rejects a rider without the delivery role', async () => {
    const { handler, deliveryWorkflow } = harness({
      rider: { id: RIDER_ID, isActive: true, roles: [{ role: { name: 'cashier' } }] },
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_RIDER_INVALID' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('rejects an unknown rider id', async () => {
    const { handler, deliveryWorkflow } = harness({ rider: null });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'DELIVERY_ASSIGNMENT_RIDER_INVALID' },
    });
    expect(deliveryWorkflow.transition).not.toHaveBeenCalled();
  });

  it('maps an illegal-transition rejection from the workflow policy to a client-safe error', async () => {
    const { handler } = harness({
      transition: jest.fn().mockRejectedValue(new DeliveryWorkflowError('ILLEGAL_TRANSITION')),
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: { code: 'ILLEGAL_TRANSITION' },
    });
  });

  it('maps a stale-version rejection from the workflow authority to a conflict (duplicate/racing assignment)', async () => {
    const { handler } = harness({
      transition: jest.fn().mockRejectedValue(new DeliveryWorkflowError('STALE_DELIVERY_WORKFLOW_VERSION')),
    });
    await expect(handler.execute(command())).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a duplicate idempotency-key-for-another-target rejection to a conflict', async () => {
    const { handler } = harness({
      transition: jest.fn().mockRejectedValue(new DeliveryWorkflowError('DELIVERY_WORKFLOW_IDEMPOTENCY_CONFLICT')),
    });
    await expect(handler.execute(command())).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns a deterministic replay result unchanged when the workflow authority replays it', async () => {
    const { handler } = harness({
      transition: jest.fn().mockResolvedValue({
        state: 'DETERMINISTIC_REPLAY',
        orderTicketId: ORDER_ID,
        fromStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        version: 1,
        idempotencyKey: 'delivery:sofia-assign:order:0:rider',
      }),
    });
    const result = await handler.execute(command());
    expect(result.resultCode).toBe('SOFIA_DELIVERY_ASSIGNED');
    expect(result.payload).toMatchObject({ state: 'DETERMINISTIC_REPLAY' });
  });
});
