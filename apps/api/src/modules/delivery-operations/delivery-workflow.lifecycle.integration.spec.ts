import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { DeliveryWorkflowConsequenceWorker } from '../orders/delivery-workflow-consequence.worker';
import { DeliveryWorkflowService } from './delivery-workflow.service';
import { DeliveryAssignmentCommandHandler } from './production/delivery-assignment-command.handler';
import type { CommandRecord } from '../secure-command/secure-command.types';

/**
 * End-to-end hardening coverage for Order READY -> delivery eligibility ->
 * rider assignment -> ASSIGNED -> IN_TRANSIT -> DELIVERED, run against a real
 * (isolated, `_test`-suffixed) Postgres instance. Complements the unit-level
 * coverage in delivery-workflow.policy.spec.ts / prisma-delivery-workflow.repository.spec.ts
 * and the SOFIA-command-level coverage in
 * production/delivery-assignment-command.integration.spec.ts.
 */
describe('Delivery lifecycle hardening (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: DeliveryWorkflowService;
  let handler: DeliveryAssignmentCommandHandler;
  let consequenceWorker: DeliveryWorkflowConsequenceWorker;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Delivery lifecycle integration tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    workflow = app.get(DeliveryWorkflowService);
    handler = app.get(DeliveryAssignmentCommandHandler);
    consequenceWorker = app.get(DeliveryWorkflowConsequenceWorker);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  function hashCanonical(value: Record<string, string>): string {
    const canonical = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  function assignCommand(input: {
    orderTicketId: string;
    riderId: string;
    expectedVersion: string;
    actorId: string;
    idOverride?: string;
  }): CommandRecord {
    return {
      id: input.idOverride ?? `cmd-${input.orderTicketId}-${input.riderId}-${input.expectedVersion}-${Math.random()}`,
      commandType: 'SOFIA_ASSIGN_DELIVERY',
      scope: 'sofia',
      idempotencyKey: `irrelevant-hashed-key-${Math.random()}`,
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

  async function createDeliveryOrder(options?: {
    status?: OrderTicketStatus;
    workflowStatus?: DeliveryWorkflowStatus;
    workflowVersion?: number;
    assignedRiderId?: string | null;
  }) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `LIFECYCLE-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DELIVERY,
        status: options?.status ?? OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: options?.assignedRiderId ?? null,
        deliveryWorkflowStatus: options?.workflowStatus ?? DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        deliveryWorkflowVersion: options?.workflowVersion ?? 0,
        customerName: 'Cliente Lifecycle',
        customerPhone: '3216660301',
        deliveryReference: 'Dirección confirmada',
        deliveryFee: 5_000,
        subtotal: 30_000,
      },
    });
    return { seed, order };
  }

  async function createSecondRider(prefix: string) {
    const deliveryRole = await prisma.role.findFirstOrThrow({ where: { name: 'delivery' } });
    return prisma.user.create({
      data: {
        email: `${prefix}-${Date.now()}-${Math.random()}@2x1burgerco.local`,
        fullName: `${prefix} Rider`,
        passwordHash: 'not-used-in-this-test',
        isActive: true,
        roles: { create: [{ roleId: deliveryRole.id }] },
      },
    });
  }

  it('rejects a conflicting reassignment attempt on an order already ASSIGNED to a different rider (no silent steal)', async () => {
    const { seed, order } = await createDeliveryOrder();
    const first = await handler.execute(
      assignCommand({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id }),
    );
    expect(first.resultCode).toBe('SOFIA_DELIVERY_ASSIGNED');

    const otherRider = await createSecondRider('steal-attempt');

    // The order is now ASSIGNED at version 1. A second command that targets
    // the *current* version but a different rider is a conflicting
    // duplicate-assignment attempt, not a legal retry, and must not silently
    // overwrite the existing assignment.
    await expect(
      handler.execute(
        assignCommand({
          orderTicketId: order.id,
          riderId: otherRider.id,
          expectedVersion: '1',
          actorId: seed.adminUser.id,
          idOverride: 'steal-attempt',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'RIDER_ALREADY_ASSIGNED' } });

    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.assignedRiderId).toBe(seed.deliveryUser.id);
    expect(unchanged.deliveryWorkflowVersion).toBe(1);
    expect(unchanged.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.ASSIGNED);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(1);
  });

  it('resolves only one winner when two concurrent transitions race to dispatch the same order (double-tap / duplicate worker dispatch)', async () => {
    const { seed, order } = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
      workflowVersion: 0,
    });
    // Bring the order to ASSIGNED first so both racers depart from the same
    // known version.
    await workflow.transition({
      orderTicketId: order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: seed.deliveryUser.id,
      actorId: seed.adminUser.id,
      reasonCode: 'RIDER_ASSIGNED',
      idempotencyKey: 'lifecycle:assign:race-setup',
    });

    const attempts = [
      workflow.transition({
        orderTicketId: order.id,
        expectedVersion: 1,
        toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
        actorId: seed.adminUser.id,
        reasonCode: 'RIDER_DEPARTED',
        idempotencyKey: 'lifecycle:dispatch:race-a',
      }),
      workflow.transition({
        orderTicketId: order.id,
        expectedVersion: 1,
        toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
        actorId: seed.adminUser.id,
        reasonCode: 'RIDER_DEPARTED',
        idempotencyKey: 'lifecycle:dispatch:race-b',
      }),
    ];

    const settled = await Promise.allSettled(attempts);
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejectedEntries = settled.filter(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    );
    expect(rejectedEntries).toHaveLength(1);
    expect(rejectedEntries[0]?.reason).toMatchObject({ code: 'STALE_DELIVERY_WORKFLOW_VERSION' });

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.IN_TRANSIT);
    expect(updated.deliveryWorkflowVersion).toBe(2);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(2);
  });

  it('rejects dispatch (IN_TRANSIT) while the order has not reached the persisted SERVED/ready state', async () => {
    const { seed, order } = await createDeliveryOrder({
      status: OrderTicketStatus.IN_PREPARATION,
      workflowStatus: DeliveryWorkflowStatus.ASSIGNED,
      workflowVersion: 1,
      assignedRiderId: null,
    });
    await prisma.orderTicket.update({ where: { id: order.id }, data: { assignedRiderId: seed.deliveryUser.id } });

    await expect(
      workflow.transition({
        orderTicketId: order.id,
        expectedVersion: 1,
        toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
        actorId: seed.adminUser.id,
        reasonCode: 'RIDER_DEPARTED',
        idempotencyKey: 'lifecycle:dispatch:not-ready',
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_READY' });

    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.ASSIGNED);
    expect(unchanged.deliveryWorkflowVersion).toBe(1);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(0);
  });

  it('rejects any workflow transition for a non-delivery-fulfillment order', async () => {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({ data: { openedById: seed.adminUser.id, openingAmount: 0 } });
    const takeaway = await prisma.orderTicket.create({
      data: {
        number: `LIFECYCLE-TAKEAWAY-${Date.now()}`,
        type: OrderTicketType.TAKEAWAY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        subtotal: 25_000,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        deliveryWorkflowVersion: 0,
      },
    });

    await expect(
      workflow.transition({
        orderTicketId: takeaway.id,
        expectedVersion: 0,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        assignedRiderId: seed.deliveryUser.id,
        actorId: seed.adminUser.id,
        reasonCode: 'RIDER_ASSIGNED',
        idempotencyKey: 'lifecycle:assign:non-delivery',
      }),
    ).rejects.toMatchObject({ code: 'NOT_DELIVERY_FULFILLMENT' });

    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: takeaway.id } })).toBe(0);
  });

  it('replays the delivery-workflow consequence reconciliation worker without duplicating audit/alert side effects (crash-restart replay safety)', async () => {
    const { seed, order } = await createDeliveryOrder();
    await handler.execute(
      assignCommand({ orderTicketId: order.id, riderId: seed.deliveryUser.id, expectedVersion: '0', actorId: seed.adminUser.id }),
    );

    // First pass: the worker discovers the new delivery_workflow_event and
    // produces its audit/alert side effects.
    await consequenceWorker.runOnce();
    const auditAfterFirst = await prisma.auditLog.count({
      where: { entityId: order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    });
    const alertsAfterFirst = await prisma.operationalAlert.count({
      where: { entityId: order.id, type: 'DELIVERY_ASSIGNED' },
    });
    expect(auditAfterFirst).toBe(1);
    expect(alertsAfterFirst).toBe(1);

    // Simulate the worker process crashing and restarting: rerunning the
    // reconciliation cycle over the same, already-processed event must be a
    // pure no-op, not a duplicate side effect.
    await consequenceWorker.runOnce();
    await consequenceWorker.runOnce();

    expect(
      await prisma.auditLog.count({ where: { entityId: order.id, action: 'ASSIGN_DELIVERY_RIDER' } }),
    ).toBe(auditAfterFirst);
    expect(
      await prisma.operationalAlert.count({ where: { entityId: order.id, type: 'DELIVERY_ASSIGNED' } }),
    ).toBe(alertsAfterFirst);
  });

  it('leaves no partial state when a failure occurs mid-transaction (simulated process crash mid-transition)', async () => {
    const { seed, order } = await createDeliveryOrder();

    // A non-existent actorId violates the DeliveryWorkflowEvent -> User FK.
    // Because the conditional orderTicket.updateMany and the
    // deliveryWorkflowEvent.create both live inside the same
    // prisma.$transaction, forcing the create to fail after the update has
    // already run must roll back the whole transaction atomically — exactly
    // as if the process had crashed between the two statements.
    await expect(
      workflow.transition({
        orderTicketId: order.id,
        expectedVersion: 0,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        assignedRiderId: seed.deliveryUser.id,
        actorId: 'nonexistent-actor-id-simulating-crash',
        reasonCode: 'RIDER_ASSIGNED',
        idempotencyKey: 'lifecycle:assign:crash-mid-transition',
      }),
    ).rejects.toBeDefined();

    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.deliveryWorkflowStatus).toBe(DeliveryWorkflowStatus.PENDING_ASSIGNMENT);
    expect(unchanged.deliveryWorkflowVersion).toBe(0);
    expect(unchanged.assignedRiderId).toBeNull();
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(0);

    // The order is not stuck: a legitimate follow-up transition against the
    // same (unchanged) version succeeds normally afterwards.
    const recovered = await workflow.transition({
      orderTicketId: order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: seed.deliveryUser.id,
      actorId: seed.adminUser.id,
      reasonCode: 'RIDER_ASSIGNED',
      idempotencyKey: 'lifecycle:assign:crash-recovery',
    });
    expect(recovered.state).toBe('APPLIED');
  });
});
