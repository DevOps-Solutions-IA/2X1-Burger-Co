import {
  DeliveryWorkflowStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import { DeliveryWorkflowError } from './delivery-workflow.repository';
import { PrismaDeliveryWorkflowRepository } from './prisma-delivery-workflow.repository';

describe('PrismaDeliveryWorkflowRepository', () => {
  const input = {
    orderTicketId: 'order-1',
    expectedVersion: 2,
    toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
    idempotencyKey: 'delivery:order-1:dispatch',
    actorId: 'rider-1',
    reasonCode: 'RIDER_DEPARTED',
    sanitizedMetadata: { source: 'OPERATOR' },
  };
  const order = {
    id: 'order-1',
    type: OrderTicketType.DELIVERY,
    status: OrderTicketStatus.SERVED,
    assignedRiderId: 'rider-1',
    deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
    deliveryWorkflowVersion: 2,
  };
  const allow = jest.fn().mockReturnValue({ allowed: true, noOp: false });

  function harness(overrides: {
    replay?: Record<string, unknown> | null;
    order?: typeof order | null;
    changed?: number;
  } = {}) {
    const tx = {
      deliveryWorkflowEvent: {
        findUnique: jest.fn().mockResolvedValue(overrides.replay ?? null),
        create: jest.fn().mockImplementation(async ({ data }) => data),
      },
      orderTicket: {
        findUnique: jest.fn().mockResolvedValue(
          Object.prototype.hasOwnProperty.call(overrides, 'order') ? overrides.order : order,
        ),
        updateMany: jest.fn().mockResolvedValue({ count: overrides.changed ?? 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
      deliveryWorkflowEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { repository: new PrismaDeliveryWorkflowRepository(prisma as never), prisma, tx };
  }

  beforeEach(() => allow.mockClear());

  it('conditionally changes current state and appends evidence in one transaction', async () => {
    const { repository, prisma, tx } = harness();

    await expect(repository.transition(input, allow)).resolves.toMatchObject({
      state: 'APPLIED',
      version: 3,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.orderTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        deliveryWorkflowVersion: 2,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
      },
      data: expect.objectContaining({
        deliveryWorkflowStatus: DeliveryWorkflowStatus.IN_TRANSIT,
        deliveryWorkflowVersion: { increment: 1 },
      }),
    });
    expect(tx.deliveryWorkflowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderTicketId: 'order-1',
        version: 3,
        idempotencyKey: input.idempotencyKey,
        fromStatus: DeliveryWorkflowStatus.ASSIGNED,
        toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
      }),
    });
  });

  it('returns deterministic replay before rejecting the old expected version', async () => {
    const { repository, tx } = harness({
      replay: {
        orderTicketId: 'order-1',
        version: 3,
        idempotencyKey: input.idempotencyKey,
        fromStatus: DeliveryWorkflowStatus.ASSIGNED,
        toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
      },
    });

    await expect(repository.transition(input, allow)).resolves.toMatchObject({
      state: 'DETERMINISTIC_REPLAY',
      version: 3,
    });
    expect(tx.orderTicket.findUnique).not.toHaveBeenCalled();
    expect(tx.deliveryWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for another target', async () => {
    const { repository } = harness({
      replay: {
        orderTicketId: 'order-1',
        version: 3,
        idempotencyKey: input.idempotencyKey,
        fromStatus: DeliveryWorkflowStatus.ASSIGNED,
        toStatus: DeliveryWorkflowStatus.ISSUE,
      },
    });

    await expect(repository.transition(input, allow)).rejects.toMatchObject({
      code: 'DELIVERY_WORKFLOW_IDEMPOTENCY_CONFLICT',
    });
  });

  it('persists nothing when the existing workflow policy rejects the transition', async () => {
    const { repository, tx } = harness();

    await expect(
      repository.transition(
        input,
        jest.fn().mockReturnValue({ allowed: false, reason: 'ORDER_NOT_READY' }),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_READY' });
    expect(tx.orderTicket.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('persists nothing when the expected workflow version is already stale', async () => {
    const { repository, tx } = harness({
      order: { ...order, deliveryWorkflowVersion: 3 },
    });

    await expect(repository.transition(input, allow)).rejects.toMatchObject({
      code: 'STALE_DELIVERY_WORKFLOW_VERSION',
    });
    expect(tx.orderTicket.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back the append path when another transition wins the version', async () => {
    const { repository, tx } = harness({ changed: 0 });

    await expect(repository.transition(input, allow)).rejects.toEqual(
      new DeliveryWorkflowError('STALE_DELIVERY_WORKFLOW_VERSION'),
    );
    expect(tx.deliveryWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('initializes a legacy null workflow and increments from version zero', async () => {
    const { repository, tx } = harness({
      order: {
        ...order,
        deliveryWorkflowStatus: null as never,
        deliveryWorkflowVersion: 0,
      },
    });

    await expect(
      repository.transition(
        { ...input, expectedVersion: 0, toStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT },
        jest.fn().mockReturnValue({ allowed: true, noOp: true }),
      ),
    ).resolves.toMatchObject({ state: 'APPLIED', fromStatus: null, version: 1 });
    expect(tx.orderTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deliveryWorkflowStatus: null }),
      }),
    );
  });
});
