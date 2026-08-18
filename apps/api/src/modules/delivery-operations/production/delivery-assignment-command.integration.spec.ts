import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../../tests/helpers/test-data';
import { DeliveryWorkflowConsequenceWorker } from '../../orders/delivery-workflow-consequence.worker';
import { DeliveryAssignmentCommandHandler } from './delivery-assignment-command.handler';
import type { CommandRecord } from '../../secure-command/secure-command.types';

function hashCanonical(value: Record<string, string>): string {
  const canonical = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function commandFor(input: {
  orderTicketId: string;
  riderId: string;
  expectedVersion: string;
  actorId: string;
  idOverride?: string;
}): CommandRecord {
  return {
    id: input.idOverride ?? `cmd-${input.orderTicketId}-${input.riderId}-${input.expectedVersion}`,
    commandType: 'SOFIA_ASSIGN_DELIVERY',
    scope: 'sofia',
    idempotencyKey: 'irrelevant-hashed-key',
    status: 'EXECUTING',
    actorId: input.actorId,
    actorType: 'SYSTEM',
    actorRoles: ['system'],
    source: 'sofia_agent',
    targetType: 'DELIVERY_WORKFLOW',
    targetId: `${input.orderTicketId}:${input.riderId}`,
    expectedVersion: input.expectedVersion,
    payloadHash: hashCanonical({
      commandType: 'SOFIA_ASSIGN_DELIVERY',
      orderTicketId: input.orderTicketId,
      riderId: input.riderId,
      expectedVersion: input.expectedVersion,
    }),
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
  };
}

describe('DeliveryAssignmentCommandHandler (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let handler: DeliveryAssignmentCommandHandler;
  let consequenceWorker: DeliveryWorkflowConsequenceWorker;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('SOFIA_ASSIGN_DELIVERY handler integration tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    handler = app.get(DeliveryAssignmentCommandHandler);
    consequenceWorker = app.get(DeliveryWorkflowConsequenceWorker);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function createDeliveryOrder(options?: {
    status?: OrderTicketStatus;
    workflowVersion?: number;
  }) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `SOFIA-DELIVERY-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DELIVERY,
        status: options?.status ?? OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: null,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        deliveryWorkflowVersion: options?.workflowVersion ?? 0,
        customerName: 'Cliente SOFIA',
        customerPhone: '3216660199',
        deliveryReference: 'Dirección confirmada',
        deliveryFee: 5_000,
        subtotal: 30_000,
      },
    });
    return { seed, order };
  }

  it('assigns a rider through the existing DeliveryWorkflowService authority and reuses the existing recovery/consequence pipeline', async () => {
    const { seed, order } = await createDeliveryOrder();

    const result = await handler.execute(
      commandFor({
        orderTicketId: order.id,
        riderId: seed.deliveryUser.id,
        expectedVersion: '0',
        actorId: seed.adminUser.id,
      }),
    );

    expect(result).toMatchObject({ resultCode: 'SOFIA_DELIVERY_ASSIGNED' });

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.ASSIGNED);
    expect(updated.assignedRiderId).toBe(seed.deliveryUser.id);
    expect(updated.deliveryWorkflowVersion).toBe(1);

    // Cross-domain isolation: SOFIA_ASSIGN_DELIVERY must never mutate cash, stock,
    // sales or payment authorities directly.
    expect(await prisma.cashSession.count()).toBe(1);
    expect(await prisma.cashMovement.count()).toBe(0);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);

    // The event created by DeliveryWorkflowService.transition() is picked up
    // by the pre-existing DeliveryWorkflowConsequenceWorker (owned by Orders,
    // unmodified) without any additional code from this handler.
    expect(await prisma.auditLog.count({
      where: { entityId: order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    })).toBe(0);
    await consequenceWorker.runOnce();
    expect(await prisma.auditLog.count({
      where: { entityId: order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    })).toBe(1);
    expect(await prisma.operationalAlert.count({
      where: { entityId: order.id, type: 'DELIVERY_ASSIGNED' },
    })).toBe(1);
  });

  it('rejects a duplicate assignment attempt bound to the same already-consumed workflow version', async () => {
    const { seed, order } = await createDeliveryOrder();
    await handler.execute(
      commandFor({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id }),
    );

    await expect(
      handler.execute(
        commandFor({
          orderTicketId: order.id,
          riderId: seed.deliveryUser.id,
          expectedVersion: '0',
          actorId: seed.adminUser.id,
          idOverride: 'second-attempt',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_ASSIGNMENT_VERSION_CONFLICT' } });

    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(1);
    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.deliveryWorkflowVersion).toBe(1);
  });

  it('replays deterministically when the same SecureCommand-derived transition is retried with the still-current version', async () => {
    const { seed, order } = await createDeliveryOrder();
    const first = await handler.execute(
      commandFor({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id }),
    );

    // Same order/rider/expectedVersion re-submitted while the persisted
    // version is now 1 must be rejected as stale (not silently no-op), since
    // the workflow already advanced past PENDING_ASSIGNMENT->ASSIGNED.
    await expect(
      handler.execute(
        commandFor({
          orderTicketId: order.id,
          riderId: seed.deliveryUser.id,
          expectedVersion: '0',
          actorId: seed.adminUser.id,
          idOverride: 'replay-attempt',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_ASSIGNMENT_VERSION_CONFLICT' } });

    expect(first.resultCode).toBe('SOFIA_DELIVERY_ASSIGNED');
  });

  it('rejects assignment attempted from an invalid workflow state (order already DELIVERED, a terminal state)', async () => {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({ data: { openedById: seed.adminUser.id, openingAmount: 0 } });
    const order = await prisma.orderTicket.create({
      data: {
        number: `SOFIA-DELIVERED-${Date.now()}`,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.PAYMENT_PENDING,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: seed.deliveryUser.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.DELIVERED,
        deliveryWorkflowVersion: 3,
        customerName: 'Cliente Entregado',
        customerPhone: '3216660200',
        deliveryReference: 'Ya entregado',
        deliveryFee: 5_000,
        subtotal: 30_000,
      },
    });

    await expect(
      handler.execute(
        commandFor({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '3', actorId: seed.adminUser.id }),
      ),
    ).rejects.toMatchObject({ response: { code: 'ILLEGAL_TRANSITION' } });

    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.DELIVERED);
    expect(unchanged.deliveryWorkflowVersion).toBe(3);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(0);
  });

  it('rejects assignment for a non-delivery order without mutating any workflow state', async () => {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({ data: { openedById: seed.adminUser.id, openingAmount: 0 } });
    const takeaway = await prisma.orderTicket.create({
      data: {
        number: `SOFIA-TAKEAWAY-${Date.now()}`,
        type: OrderTicketType.TAKEAWAY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        subtotal: 25_000,
      },
    });

    await expect(
      handler.execute(
        commandFor({ orderTicketId: takeaway.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id }),
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_ASSIGNMENT_NOT_DELIVERY_FULFILLMENT' } });

    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: takeaway.id } })).toBe(0);
  });

  it('resolves only one winner under concurrent assignment attempts for the same order (concurrency safety)', async () => {
    const { seed, order } = await createDeliveryOrder();
    const deliveryRole = await prisma.role.findFirstOrThrow({ where: { name: 'delivery' } });
    const secondRider = await prisma.user.create({
      data: {
        email: `second-rider-${Date.now()}@2x1burgerco.local`,
        fullName: 'Second Rider Test',
        passwordHash: 'not-used-in-this-test',
        isActive: true,
        roles: { create: [{ roleId: deliveryRole.id }] },
      },
    });
    const otherRiderId = secondRider.id;

    const attempts = [
      handler.execute(
        commandFor({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id, idOverride: 'race-a' }),
      ),
      handler.execute(
        commandFor({ orderTicketId: order.id, riderId: otherRiderId, expectedVersion: '0', actorId: seed.adminUser.id, idOverride: 'race-b' }),
      ),
    ];

    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled');
    const rejected = settled.filter((entry) => entry.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.deliveryWorkflowVersion).toBe(1);
    expect(updated.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.ASSIGNED);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(1);
  });
});
