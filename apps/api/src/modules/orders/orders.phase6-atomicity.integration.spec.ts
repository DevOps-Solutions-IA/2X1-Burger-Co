import { BadRequestException, type INestApplication } from '@nestjs/common';
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
import { DeliveryWorkflowConsequenceWorker } from './delivery-workflow-consequence.worker';

describe('OrdersService Phase 6 delivery/location atomicity', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;
  let workflow: DeliveryWorkflowService;
  let consequenceWorker: DeliveryWorkflowConsequenceWorker;

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
    consequenceWorker = app.get(DeliveryWorkflowConsequenceWorker);
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

  it('keeps delivery workflow authority untouched during a generic order edit', async () => {
    const fixture = await createDeliveryOrder({
      workflowStatus: DeliveryWorkflowStatus.IN_TRANSIT,
      workflowVersion: 7,
    });
    const statusUpdatedAt = new Date('2026-08-09T03:00:00.000Z');
    const dispatchedAt = new Date('2026-08-09T03:01:00.000Z');
    await prisma.orderTicket.update({
      where: { id: fixture.order.id },
      data: { deliveryStatusUpdatedAt: statusUpdatedAt, deliveryDispatchedAt: dispatchedAt },
    });

    await orders.update(fixture.order.id, { notes: 'Nota comercial sin transición.' }, fixture.actor);

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({
      deliveryWorkflowStatus: DeliveryWorkflowStatus.IN_TRANSIT,
      deliveryWorkflowVersion: 7,
      deliveryStatusUpdatedAt: statusUpdatedAt,
      deliveryDispatchedAt: dispatchedAt,
      assignedRiderId: fixture.seed.deliveryUser.id,
      notes: 'Nota comercial sin transición.',
    });
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: fixture.order.id } })).toBe(0);
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
        notes: null,
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

  it('recovers ISSUE consequences from persisted event facts without request replay', async () => {
    const fixture = await createDeliveryOrder();
    await workflow.transition({
      orderTicketId: fixture.order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ISSUE,
      actorId: fixture.seed.adminUser.id,
      reasonCode: 'FAULT_AFTER_DELIVERY_EVENT',
      idempotencyKey: `delivery:fault:${fixture.order.id}:issue`,
      sanitizedMetadata: {
        issueType: DeliveryIssueType.ROUTE_INCIDENT,
        notes: 'Novedad de ruta verificada.',
      },
    });

    expect(await prisma.deliveryIssue.count({ where: { orderTicketId: fixture.order.id } })).toBe(0);
    expect(await prisma.operationalAlert.count({ where: { entityId: fixture.order.id } })).toBe(0);

    await consequenceWorker.runOnce();
    expect(await orders.reconcilePendingDeliveryWorkflowConsequences()).toBe(0);

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

  // SOFIA Round 5 / A14 CLOSURE — legacy POS symmetric gap to the A13 SOFIA finding. The pre-existing
  // `deliveryLocationConflicts` check (`orders.service.ts`, 0.15km threshold) already blocks the
  // logistics-only path from silently applying a materially-different coordinate pair WHEN THE ORDER
  // ALREADY HAS coordinates (see "routes conflicting coordinates to review" above). But that check is
  // a no-op (`return false`) whenever the order has NO coordinates yet — exactly the shape of a
  // LOCAL_FREE zone-text-only match (the A8/A11 CRITICAL precedent: a resolved, priced order with
  // zero recorded coordinate evidence). Before this fix, a genuinely far live-location landing on such
  // an order via this same "logistics only, pricing preserved" path would be silently applied with NO
  // repricing and NO checkout gate — the order could still be charged for a free local zone despite
  // real, TRUSTED evidence the destination is actually 42km away. This test proves that gap is closed:
  // `deliveryRequiresManualQuote` is flipped `true` (reusing the EXISTING canonical checkout-authority
  // column/derivation, `deriveCheckoutAuthorizationFromOrderSnapshot` — see `delivery-checkout-authorization.ts`),
  // and `checkout()` is blocked until a real repricing pass runs.
  describe('SOFIA Round 5 / A14 — legacy POS logistics-only location update vs. checkout authority', () => {
    async function createResolvedDeliveryOrder(options: {
      latitude: number | null;
      longitude: number | null;
      deliveryFee: number;
      pricingStatus: string;
    }) {
      const seed = await seedTestData(prisma);
      const cashSession = await prisma.cashSession.create({
        data: { openedById: seed.adminUser.id, openingAmount: 0 },
      });
      const order = await prisma.orderTicket.create({
        data: {
          number: `P6-A14-${Date.now()}-${Math.random()}`,
          type: OrderTicketType.DELIVERY,
          status: OrderTicketStatus.SERVED, // ACTIVE_ORDER_STATUSES — pre-payment, not yet checked out
          cashSessionId: cashSession.id,
          createdById: seed.adminUser.id,
          customerName: 'Cliente A14 Legacy',
          customerPhone: '3215550199',
          deliveryReference: 'Barrio Alborada, casa azul',
          deliveryAddressNormalized: 'barrio alborada casa azul',
          deliveryLatitude: options.latitude,
          deliveryLongitude: options.longitude,
          deliveryLocationSource: options.latitude != null ? 'geocoded_address' : null,
          deliveryFee: options.deliveryFee,
          deliveryPricingStatus: options.pricingStatus,
          deliveryPricingConfidence: 'HIGH',
          // A REAL resolved pricing snapshot — the exact `hasCalculationSnapshot` shape
          // `assertDeliveryCheckoutAllowed`/`deriveCheckoutAuthorizationFromOrderSnapshot` require.
          deliveryPricingBreakdown: [{ code: options.pricingStatus, label: 'Tarifa calculada', amount: options.deliveryFee }],
          deliveryCalculationVersion: '2x1-delivery-pricing-v1',
          deliveryRequiresManualQuote: false,
          subtotal: 20_000,
          items: {
            create: [{ productId: seed.burger.id, quantity: 1, unitPrice: 20_000, totalPrice: 20_000 }],
          },
        },
      });
      return { seed, order, actor: actor(seed.adminUser) };
    }

    it(
      'a bare live-location share landing on a resolved LOCAL_FREE order with NO prior coordinates ' +
        'now blocks checkout until a real repricing pass runs (previously: silently applied, checkout ' +
        'still allowed at the stale $0 fee)',
      async () => {
        const fixture = await createResolvedDeliveryOrder({ latitude: null, longitude: null, deliveryFee: 0, pricingStatus: 'LOCAL_FREE' });

        // A genuinely far point (~50km away, well past any jitter tolerance) arrives with no prior
        // coordinate evidence to compare against — `deliveryLocationConflicts` is a structural no-op
        // here (`currentLatitude == null`), so this is NOT intercepted by the pre-existing REQUIRES_REVIEW
        // path; it reaches `applyDeliveryLocationForLogisticsOnlyInTransaction` directly.
        const captured = await orders.captureDeliveryLocationFromWhatsapp({
          senderPhoneCandidates: ['3215550199'],
          latitude: 3.62,
          longitude: -76.15,
          actorId: fixture.actor.sub,
        });
        expect(captured.order?.id).toBe(fixture.order.id);

        const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
        // Coordinates ARE applied (logistics still needs them to route the courier)...
        expect(Number(updated.deliveryLatitude)).toBeCloseTo(3.62, 5);
        expect(Number(updated.deliveryLongitude)).toBeCloseTo(-76.15, 5);
        // ...the persisted fee/status are untouched (this path still never silently reprices)...
        expect(Number(updated.deliveryFee)).toBe(0);
        expect(updated.deliveryPricingStatus).toBe('LOCAL_FREE');
        // ...but the canonical "needs a real repricing pass before checkout" flag is now set:
        expect(updated.deliveryRequiresManualQuote).toBe(true);

        // The existing, unmodified canonical checkout gate (`assertDeliveryCheckoutAllowed` via
        // `checkout()`) now refuses to charge this order at the stale LOCAL_FREE fee.
        await expect(
          orders.checkout(
            fixture.order.id,
            { baseSubtotal: 20_000, payments: [{ paymentMethodId: fixture.seed.paymentCash.id, amount: 20_000 }] },
            fixture.actor.sub,
          ),
        ).rejects.toThrow(BadRequestException);

        const stillOpen = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
        expect(stillOpen.status).not.toBe(OrderTicketStatus.PAID);
      },
    );

    it(
      'a live-location share within GPS jitter tolerance of the EXISTING bound coordinates does NOT ' +
        'force an unnecessary checkout block (benign refinement, same effective point)',
      async () => {
        const fixture = await createResolvedDeliveryOrder({
          latitude: 3.2686,
          longitude: -76.5516,
          deliveryFee: 5_000,
          pricingStatus: 'AUTO_PRICED',
        });

        // ~30m offset — comfortably inside the 150m material-difference threshold (and inside the
        // pre-existing `deliveryLocationConflicts` 150m threshold too, so this is not even routed to
        // manual review): GPS accuracy noise around the same point, not a genuinely different one.
        const captured = await orders.captureDeliveryLocationFromWhatsapp({
          senderPhoneCandidates: ['3215550199'],
          latitude: 3.26887,
          longitude: -76.55163,
          actorId: fixture.actor.sub,
        });
        expect(captured.order?.id).toBe(fixture.order.id);

        const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
        expect(Number(updated.deliveryFee)).toBe(5_000);
        expect(updated.deliveryPricingStatus).toBe('AUTO_PRICED');
        // No unnecessary requote/block was forced by benign jitter:
        expect(updated.deliveryRequiresManualQuote).toBe(false);

        const sale = await orders.checkout(
          fixture.order.id,
          { baseSubtotal: 25_000, payments: [{ paymentMethodId: fixture.seed.paymentCash.id, amount: 25_000 }] },
          fixture.actor.sub,
        );
        expect(sale.order.status).toBe(OrderTicketStatus.PAID);
      },
    );
  });
});
