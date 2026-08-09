import type { INestApplication } from '@nestjs/common';
import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  DeliveryWorkflowStatus,
  OrderTicketType,
} from '@prisma/client';
import { CustomerServiceCaseService } from '../modules/customer-service/customer-service-case.service';
import { DeliveryWorkflowService } from '../modules/delivery-operations/delivery-workflow.service';
import { NotificationOutboxService } from '../modules/notifications/notification-outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

describe('Phase 6 PostgreSQL concurrency authorities', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Phase 6 integration requires an isolated _test database.');
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('allows one delivery transition winner and appends one event', async () => {
    const seed = await seedTestData(prisma);
    const session = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: 'P6-DELIVERY-1',
        type: OrderTicketType.DELIVERY,
        cashSessionId: session.id,
        createdById: seed.adminUser.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
      },
    });
    const service = app.get(DeliveryWorkflowService);
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.transition({
      orderTicketId: order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: seed.deliveryUser.id,
      actorId: seed.adminUser.id,
      reasonCode: 'CONCURRENCY_TEST',
      idempotencyKey: `delivery:concurrency:${index}`,
    })));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.deliveryWorkflowEvent.count({ where: { orderTicketId: order.id } })).toBe(1);
    await expect(prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      deliveryWorkflowVersion: 1,
      deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: seed.deliveryUser.id,
    });
  });

  it('deduplicates namespaced notifications and gives one worker the lease', async () => {
    const service = app.get(NotificationOutboxService);
    const input = {
      eventType: 'ORDER_CONFIRMED',
      sourceEventId: 'event-1',
      aggregateType: 'ORDER_CHECKOUT',
      aggregateId: 'checkout-1',
      aggregateVersion: 1,
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
      factEnvelope: { state: 'CONFIRMED' },
      policyOutcome: 'ALLOWED' as const,
    };
    const rows = await Promise.all(Array.from({ length: 8 }, () => service.enqueue(input)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    const secondNamespace = await service.enqueue({ ...input, aggregateType: 'ORDER_TICKET' });
    expect(secondNamespace.id).not.toBe(rows[0]!.id);

    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => service.claim(rows[0]!.id, `worker-${index}`)));
    expect(claims.filter((claim) => claim.state === 'CLAIMED')).toHaveLength(1);
    expect(await prisma.notificationIntent.count()).toBe(2);
  });

  it('deduplicates complaint creation and permits one status transition winner', async () => {
    const service = app.get(CustomerServiceCaseService);
    const input = {
      category: 'MISSING_ITEM' as const,
      source: 'WHATSAPP',
      sourceReference: 'event-complaint-1',
      idempotencyKey: 'complaint:open:event-complaint-1',
      evidenceHash: 'a'.repeat(64),
      summary: 'Faltó un producto.',
    };
    const opened = await Promise.all(Array.from({ length: 8 }, () => service.open(input)));
    const caseId = opened[0]!.serviceCase.id;
    expect(new Set(opened.map((result) => result.serviceCase.id)).size).toBe(1);

    const transitions = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.transition({
      caseId,
      expectedVersion: 0,
      idempotencyKey: `complaint:human:${index}`,
      fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED',
      reasonCode: 'CUSTOMER_COMPLAINT_REQUIRES_HUMAN',
    })));
    expect(transitions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.customerServiceCase.count()).toBe(1);
    expect(await prisma.customerServiceCaseEvent.count({ where: { caseId } })).toBe(2);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.paymentTransition.count()).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);
    expect(await prisma.cashMovement.count()).toBe(0);
  });
});
