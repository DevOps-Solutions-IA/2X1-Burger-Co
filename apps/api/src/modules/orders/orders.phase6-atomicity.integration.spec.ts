import type { INestApplication } from '@nestjs/common';
import {
  DeliveryIssueStatus,
  DeliveryIssueType,
  DeliveryLocationInboxStatus,
  DeliveryWorkflowStatus,
  OperationalAlertStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { DeliveryWorkflowService } from '../delivery-operations/delivery-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { OrdersService } from './orders.service';

describe('OrdersService Phase 6 delivery/location atomicity', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;
  let workflow: DeliveryWorkflowService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Orders Phase 6 atomicity tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    orders = app.get(OrdersService);
    workflow = app.get(DeliveryWorkflowService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  function actor(user: { id: string; email: string; fullName: string }): AuthUser {
    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: 0,
      roles: ['admin'],
      permissions: ['delivery.update'],
    };
  }

  async function createDeliveryOrder(options?: {
    workflowStatus?: DeliveryWorkflowStatus;
    workflowVersion?: number;
    status?: OrderTicketStatus;
    assignedRiderId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    deliveryFee?: number;
    subtotal?: number;
  }) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `P6-ATOMIC-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DELIVERY,
        status: options?.status ?? OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId:
          options && 'assignedRiderId' in options
            ? options.assignedRiderId
            : seed.deliveryUser.id,
        deliveryWorkflowStatus: options?.workflowStatus ?? DeliveryWorkflowStatus.ASSIGNED,
        deliveryWorkflowVersion: options?.workflowVersion ?? 0,
        customerName: 'Cliente Atomicidad',
        customerPhone: '3215550199',
        deliveryReference: 'Dirección comercial confirmada',
        deliveryLatitude: options?.latitude,
        deliveryLongitude: options?.longitude,
        deliveryLocationSource:
          options?.latitude != null && options.longitude != null ? 'commercial_quote' : null,
        deliveryFee: options?.deliveryFee ?? 5_000,
        subtotal: options?.subtotal ?? 30_000,
      },
    });
    return { seed, order, actor: actor(seed.adminUser) };
  }

  it('rejects delivery fulfillment changes before mutating workflow or commercial truth', async () => {
    const fixture = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.ASSIGNED,
      workflowVersion: 4,
      deliveryFee: 5_000,
      subtotal: 30_000,
    });

    await expect(orders.update(
      fixture.order.id,
      { type: 'TAKEAWAY', notes: 'No debe persistirse.' },
      fixture.actor,
    )).rejects.toMatchObject({
      response: { code: 'DELIVERY_FULFILLMENT_CHANGE_REQUIRES_GOVERNED_TRANSITION' },
    });

    const unchanged = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    expect(unchanged).toMatchObject({
      type: OrderTicketType.DELIVERY,
      deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
      deliveryWorkflowVersion: 4,
      revision: 0,
      notes: null,
    });
    expect(Number(unchanged.deliveryFee)).toBe(5_000);
    expect(Number(unchanged.subtotal)).toBe(30_000);
    expect(await prisma.deliveryWorkflowEvent.count({
      where: { orderTicketId: fixture.order.id },
    })).toBe(0);
  });

  it('rejects conversion into delivery before creating unversioned workflow state', async () => {
    const fixture = await createDeliveryOrder();
    const takeaway = await prisma.orderTicket.create({
      data: {
        number: `P6-TAKEAWAY-${Date.now()}`,
        type: OrderTicketType.TAKEAWAY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: fixture.order.cashSessionId,
        createdById: fixture.seed.adminUser.id,
        subtotal: 25_000,
      },
    });

    await expect(orders.update(
      takeaway.id,
      { type: 'DELIVERY', deliveryReference: 'No debe persistirse.' },
      fixture.actor,
    )).rejects.toMatchObject({
      response: { code: 'DELIVERY_FULFILLMENT_CHANGE_REQUIRES_GOVERNED_TRANSITION' },
    });

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: takeaway.id } })).toMatchObject({
      type: OrderTicketType.TAKEAWAY,
      deliveryWorkflowStatus: null,
      deliveryWorkflowVersion: 0,
      deliveryReference: null,
      revision: 0,
    });
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: takeaway.id } })).toBe(0);
  });

  it('recovers rider assignment audit and alert after a persisted transition', async () => {
    const fixture = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
      assignedRiderId: null,
    });
    await workflow.transition({
      orderTicketId: fixture.order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: fixture.seed.deliveryUser.id,
      actorId: fixture.seed.adminUser.id,
      reasonCode: 'FAULT_AFTER_RIDER_ASSIGNMENT_EVENT',
      idempotencyKey: `delivery:assign:${fixture.order.id}:0:${fixture.seed.deliveryUser.id}`,
      sanitizedMetadata: {
        previousAssignedRiderId: null,
        assignedRiderId: fixture.seed.deliveryUser.id,
        notesPresent: false,
      },
    });

    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    })).toBe(0);
    expect(await prisma.operationalAlert.count({
      where: { entityId: fixture.order.id, type: 'DELIVERY_ASSIGNED' },
    })).toBe(0);

    await orders.assignDeliveryRider(
      fixture.order.id,
      { riderId: fixture.seed.deliveryUser.id },
      fixture.actor,
    );
    await orders.assignDeliveryRider(
      fixture.order.id,
      { riderId: fixture.seed.deliveryUser.id },
      fixture.actor,
    );

    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    })).toBe(1);
    expect(await prisma.operationalAlert.count({
      where: { entityId: fixture.order.id, type: 'DELIVERY_ASSIGNED' },
    })).toBe(1);
    expect(await prisma.deliveryWorkflowEvent.count({
      where: { orderTicketId: fixture.order.id },
    })).toBe(1);
  });

  it('rolls back assignment consequences on fault and resumes them on replay', async () => {
    const fixture = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
      assignedRiderId: null,
    });
    await workflow.transition({
      orderTicketId: fixture.order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: fixture.seed.deliveryUser.id,
      actorId: fixture.seed.adminUser.id,
      reasonCode: 'FAULT_BEFORE_ASSIGNMENT_CONSEQUENCES',
      idempotencyKey: `delivery:assign:${fixture.order.id}:0:${fixture.seed.deliveryUser.id}`,
    });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase6_reject_assignment_alert() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'DELIVERY_ASSIGNED' THEN
          RAISE EXCEPTION 'PHASE6_ASSIGNMENT_ALERT_FAULT';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER phase6_reject_assignment_alert_trigger
      BEFORE INSERT ON operational_alerts
      FOR EACH ROW EXECUTE FUNCTION phase6_reject_assignment_alert()
    `);

    try {
      await expect(orders.assignDeliveryRider(
        fixture.order.id,
        { riderId: fixture.seed.deliveryUser.id },
        fixture.actor,
      )).rejects.toThrow();
      expect(await prisma.auditLog.count({
        where: { entityId: fixture.order.id, action: 'ASSIGN_DELIVERY_RIDER' },
      })).toBe(0);
      expect(await prisma.operationalAlert.count({
        where: { entityId: fixture.order.id, type: 'DELIVERY_ASSIGNED' },
      })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS phase6_reject_assignment_alert_trigger ON operational_alerts',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase6_reject_assignment_alert()');
    }

    await orders.assignDeliveryRider(
      fixture.order.id,
      { riderId: fixture.seed.deliveryUser.id },
      fixture.actor,
    );

    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'ASSIGN_DELIVERY_RIDER' },
    })).toBe(1);
    expect(await prisma.operationalAlert.count({
      where: { entityId: fixture.order.id, type: 'DELIVERY_ASSIGNED' },
    })).toBe(1);
    expect(await prisma.deliveryWorkflowEvent.count({
      where: { orderTicketId: fixture.order.id },
    })).toBe(1);
  });

  it('resumes ISSUE consequences after a persisted transition and deduplicates replay', async () => {
    const fixture = await createDeliveryOrder();
    await workflow.transition({
      orderTicketId: fixture.order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ISSUE,
      actorId: fixture.seed.adminUser.id,
      reasonCode: 'FAULT_AFTER_DELIVERY_EVENT',
      idempotencyKey: `delivery:fault:${fixture.order.id}:issue`,
      sanitizedMetadata: { issueType: DeliveryIssueType.ROUTE_INCIDENT },
    });

    expect(await prisma.deliveryIssue.count({ where: { orderTicketId: fixture.order.id } })).toBe(0);
    expect(await prisma.operationalAlert.count({ where: { entityId: fixture.order.id } })).toBe(0);

    const dto = {
      workflowStatus: 'ISSUE' as const,
      issueType: 'ROUTE_INCIDENT' as const,
      notes: 'Novedad de ruta verificada.',
    };
    await orders.updateDeliveryWorkflow(fixture.order.id, dto, fixture.actor);
    await orders.updateDeliveryWorkflow(fixture.order.id, dto, fixture.actor);

    expect(await prisma.deliveryIssue.count({ where: { orderTicketId: fixture.order.id } })).toBe(1);
    expect(await prisma.operationalAlert.count({
      where: { entityId: fixture.order.id, type: 'DELIVERY_ISSUE' },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'UPDATE_DELIVERY_WORKFLOW' },
    })).toBe(1);
    expect((await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } })).notes)
      .toBe('Novedad de ruta verificada.');
  });

  it('resumes DELIVERED resolution and alert consequences without duplication', async () => {
    const fixture = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.IN_TRANSIT,
    });
    const issue = await prisma.deliveryIssue.create({
      data: {
        orderTicketId: fixture.order.id,
        issueType: DeliveryIssueType.CUSTOMER_UNREACHABLE,
        summary: 'Cliente no disponible.',
        reportedById: fixture.seed.adminUser.id,
      },
    });
    await prisma.operationalAlert.create({
      data: {
        type: 'DELIVERY_ISSUE',
        module: 'deliveries',
        severity: 'CRITICAL',
        title: 'Novedad',
        message: 'Novedad pendiente.',
        entityType: 'order_ticket',
        entityId: fixture.order.id,
        deliveryIssueId: issue.id,
      },
    });
    await workflow.transition({
      orderTicketId: fixture.order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.DELIVERED,
      actorId: fixture.seed.adminUser.id,
      reasonCode: 'FAULT_AFTER_DELIVERED_EVENT',
      idempotencyKey: `delivery:fault:${fixture.order.id}:delivered`,
    });

    await orders.updateDeliveryWorkflow(
      fixture.order.id,
      { workflowStatus: 'DELIVERED' },
      fixture.actor,
    );
    await orders.updateDeliveryWorkflow(
      fixture.order.id,
      { workflowStatus: 'DELIVERED' },
      fixture.actor,
    );

    expect(await prisma.deliveryIssue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({
      status: DeliveryIssueStatus.RESOLVED,
      resolvedById: fixture.seed.adminUser.id,
    });
    expect(await prisma.operationalAlert.count({
      where: { entityId: fixture.order.id, type: 'DELIVERY_DELIVERED' },
    })).toBe(1);
    expect(await prisma.operationalAlert.findFirstOrThrow({
      where: { entityId: fixture.order.id, type: 'DELIVERY_ISSUE' },
    })).toMatchObject({ status: OperationalAlertStatus.RESOLVED });
  });

  it('coordinates concurrent manual inbox resolution with one order mutation and one alert', async () => {
    const fixture = await createDeliveryOrder({ latitude: null, longitude: null });
    const inbox = await prisma.deliveryLocationInbox.create({
      data: {
        sourceEventKey: `manual:${fixture.order.id}`,
        payloadHash: 'manual-location-hash',
        latitude: 3.2686,
        longitude: -76.5516,
        matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
        processedAt: new Date(),
      },
    });
    await prisma.operationalAlert.create({
      data: {
        type: 'DELIVERY_LOCATION_PENDING_REVIEW',
        module: 'deliveries',
        severity: 'WARNING',
        title: 'Ubicación pendiente',
        message: 'Pendiente.',
        entityType: 'delivery_location_inbox',
        entityId: inbox.id,
        deliveryLocationInboxId: inbox.id,
      },
    });

    const results = await Promise.all(Array.from({ length: 4 }, () =>
      orders.resolveDeliveryLocationInbox(inbox.id, { orderId: fixture.order.id }, fixture.actor)));

    expect(new Set(results.map((result) => 'order' in result ? result.order?.id : null))).toEqual(
      new Set([fixture.order.id]),
    );
    expect(await prisma.operationalAlert.count({
      where: { type: 'DELIVERY_LOCATION_RECEIVED', deliveryLocationInboxId: inbox.id },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY' },
    })).toBe(1);
    const persistedInbox = await prisma.deliveryLocationInbox.findUniqueOrThrow({ where: { id: inbox.id } });
    expect(persistedInbox).toMatchObject({
      matchStatus: DeliveryLocationInboxStatus.APPLIED,
      matchedOrderId: fixture.order.id,
      version: 1,
    });
    const persistedOrder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(persistedOrder.revision).toBe(1);
    expect(Number(persistedOrder.deliveryFee)).toBe(5_000);
    expect(Number(persistedOrder.subtotal)).toBe(30_000);
  });

  it('keeps an applied location alert recoverable and unique across source-event replay', async () => {
    const fixture = await createDeliveryOrder({ latitude: null, longitude: null });
    const input = {
      sourceEventKey: `location-event:${fixture.order.id}`,
      payloadHash: 'location-event-payload-hash',
      senderPhoneCandidates: ['3215550199'],
      latitude: 3.2686,
      longitude: -76.5516,
    };
    const first = await orders.captureDeliveryLocationFromWhatsapp(input);
    const replay = await orders.captureDeliveryLocationFromWhatsapp(input);

    expect(first.alert?.id).toBeTruthy();
    expect(replay.alert?.id).toBe(first.alert?.id);
    expect(await prisma.operationalAlert.count({
      where: { type: 'DELIVERY_LOCATION_RECEIVED', deliveryLocationInboxId: first.inbox.id },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY' },
    })).toBe(1);
  });

  it('rolls back inbox/order/audit when alert persistence fails and completes on replay', async () => {
    const fixture = await createDeliveryOrder({ latitude: null, longitude: null });
    const input = {
      sourceEventKey: `location-alert-fault:${fixture.order.id}`,
      payloadHash: 'location-alert-fault-payload-hash',
      senderPhoneCandidates: ['3215550199'],
      latitude: 3.2686,
      longitude: -76.5516,
    };
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION phase6_reject_location_alert() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'DELIVERY_LOCATION_RECEIVED' THEN
          RAISE EXCEPTION 'PHASE6_ALERT_FAULT';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER phase6_reject_location_alert_trigger
      BEFORE INSERT ON operational_alerts
      FOR EACH ROW EXECUTE FUNCTION phase6_reject_location_alert()
    `);

    try {
      await expect(orders.captureDeliveryLocationFromWhatsapp(input)).rejects.toThrow();
      const pending = await prisma.deliveryLocationInbox.findUniqueOrThrow({
        where: { sourceEventKey: input.sourceEventKey },
      });
      expect(pending).toMatchObject({
        matchStatus: DeliveryLocationInboxStatus.PENDING,
        processedAt: null,
        version: 0,
      });
      expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({
        deliveryLatitude: null,
        deliveryLongitude: null,
        revision: 0,
      });
      expect(await prisma.auditLog.count({
        where: { entityId: fixture.order.id, action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY' },
      })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS phase6_reject_location_alert_trigger ON operational_alerts');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase6_reject_location_alert()');
    }

    const recovered = await orders.captureDeliveryLocationFromWhatsapp(input);
    expect(recovered.inbox.matchStatus).toBe(DeliveryLocationInboxStatus.APPLIED);
    expect(await prisma.operationalAlert.count({
      where: { type: 'DELIVERY_LOCATION_RECEIVED', deliveryLocationInboxId: recovered.inbox.id },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { entityId: fixture.order.id, action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY' },
    })).toBe(1);
    expect((await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } })).revision).toBe(1);
  });

  it('routes conflicting coordinates to review without changing commercial pricing or coordinates', async () => {
    const fixture = await createDeliveryOrder({
      latitude: 3.2686,
      longitude: -76.5516,
      deliveryFee: 5_000,
      subtotal: 30_000,
    });
    const input = {
      sourceEventKey: `location-conflict:${fixture.order.id}`,
      payloadHash: 'location-conflict-payload-hash',
      senderPhoneCandidates: ['3215550199'],
      latitude: 3.4100,
      longitude: -76.6200,
    };
    const first = await orders.captureDeliveryLocationFromWhatsapp(input);
    const replay = await orders.captureDeliveryLocationFromWhatsapp(input);

    expect(first.order).toBeNull();
    expect(first.inbox).toMatchObject({
      matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
      matchedOrderId: fixture.order.id,
      matchedRule: 'coordinate_conflict',
    });
    expect(replay.alert?.id).toBe(first.alert?.id);
    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(Number(unchanged.deliveryLatitude)).toBe(3.2686);
    expect(Number(unchanged.deliveryLongitude)).toBe(-76.5516);
    expect(Number(unchanged.deliveryFee)).toBe(5_000);
    expect(Number(unchanged.subtotal)).toBe(30_000);
    expect(unchanged.revision).toBe(0);
    expect(await prisma.operationalAlert.count({
      where: { type: 'DELIVERY_LOCATION_PENDING_REVIEW', deliveryLocationInboxId: first.inbox.id },
    })).toBe(1);

    const manualReplay = await orders.resolveDeliveryLocationInbox(
      first.inbox.id,
      { orderId: fixture.order.id },
      fixture.actor,
    );
    expect('order' in manualReplay ? manualReplay.order : undefined).toBeNull();
    expect((await prisma.deliveryLocationInbox.findUniqueOrThrow({ where: { id: first.inbox.id } })).version)
      .toBe(first.inbox.version);
  });
});
