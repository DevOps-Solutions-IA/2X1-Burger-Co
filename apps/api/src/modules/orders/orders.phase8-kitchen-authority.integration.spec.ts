import type { INestApplication } from '@nestjs/common';
import { OrderTicketStatus, OrderTicketType } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from './orders.service';

describe('OrdersService Phase 8 kitchen authority persistence', () => {
  let app: INestApplication;
  let audit: AuditService;
  let orders: OrdersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Kitchen authority integration tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    audit = app.get(AuditService);
    orders = app.get(OrdersService);
  });

  afterAll(async () => closeTestApp(app));
  beforeEach(async () => resetDatabase(prisma));

  function actor(
    user: { id: string; email: string; fullName: string },
    roles: string[],
    permissions: string[] = [],
  ): AuthUser {
    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: 0,
      roles,
      permissions,
    };
  }

  async function fixture(status: OrderTicketStatus) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `P8-KITCHEN-${status}-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DINE_IN,
        status,
        tableId: seed.tableOne.id,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedWaiterId: seed.waiterUser.id,
        subtotal: 25_000,
        items: {
          create: {
            productId: seed.burger.id,
            quantity: 1,
            unitPrice: 25_000,
            totalPrice: 25_000,
          },
        },
      },
    });
    return {
      seed,
      order,
      admin: actor(seed.adminUser, ['admin'], ['orders.update']),
      adminWithoutPermission: actor(seed.adminUser, ['admin']),
      waiter: actor(seed.waiterUser, ['waiter']),
    };
  }

  it.each([
    [OrderTicketStatus.OPEN, OrderTicketStatus.SERVED],
    [OrderTicketStatus.IN_PREPARATION, OrderTicketStatus.OPEN],
  ])('persists zero rows for generic %s -> %s bypass attempts', async (current, requested) => {
    const context = await fixture(current);

    await expect(orders.update(
      context.order.id,
      { status: requested, expectedRevision: context.order.revision },
      context.admin,
    )).rejects.toMatchObject({
      response: { code: 'KITCHEN_TRANSITION_REQUIRES_GOVERNED_ENDPOINT' },
    });

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: context.order.id } }))
      .toMatchObject({ status: current, revision: context.order.revision });
  });

  it('allows one concurrent kitchen transition winner for the same expected revision', async () => {
    const context = await fixture(OrderTicketStatus.OPEN);

    const results = await Promise.allSettled([
      orders.transitionKitchen(
        context.order.id,
        { action: 'START_PREPARATION', expectedRevision: context.order.revision },
        context.admin,
      ),
      orders.transitionKitchen(
        context.order.id,
        { action: 'START_PREPARATION', expectedRevision: context.order.revision },
        context.admin,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: context.order.id } }))
      .toMatchObject({ status: OrderTicketStatus.IN_PREPARATION, revision: 1 });
    expect(await prisma.auditLog.count({
      where: {
        action: 'KITCHEN_TRANSITION',
        entityId: context.order.id,
      },
    })).toBe(1);
  });

  it('rolls back status and revision when transactional audit creation fails', async () => {
    const context = await fixture(OrderTicketStatus.OPEN);
    const auditCountBefore = await prisma.auditLog.count();
    const auditFailure = jest.spyOn(audit, 'log').mockRejectedValueOnce(
      new Error('injected audit persistence failure'),
    );

    await expect(orders.transitionKitchen(
      context.order.id,
      { action: 'START_PREPARATION', expectedRevision: context.order.revision },
      context.admin,
    )).rejects.toThrow('injected audit persistence failure');

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: context.order.id } }))
      .toMatchObject({ status: OrderTicketStatus.OPEN, revision: 0 });
    expect(await prisma.auditLog.count()).toBe(auditCountBefore);
    auditFailure.mockRestore();
  });

  it('rejects waiter kitchen transitions through both generic update and waiter sync', async () => {
    const context = await fixture(OrderTicketStatus.OPEN);

    await expect(orders.transitionKitchen(
      context.order.id,
      { action: 'START_PREPARATION', expectedRevision: context.order.revision },
      context.waiter,
    )).rejects.toMatchObject({ response: { code: 'KITCHEN_TRANSITION_FORBIDDEN' } });

    await expect(orders.update(
      context.order.id,
      { status: 'IN_PREPARATION', expectedRevision: context.order.revision },
      context.waiter,
    )).rejects.toMatchObject({
      response: { code: 'KITCHEN_TRANSITION_REQUIRES_GOVERNED_ENDPOINT' },
    });

    await expect(orders.syncWaiterOrder({
      orderId: context.order.id,
      tableId: context.seed.tableOne.id,
      status: 'IN_PREPARATION',
      expectedRevision: context.order.revision,
      clientMutationId: `p8-kitchen-bypass-${context.order.id}`,
      items: [{ productId: context.seed.burger.id, quantity: 1 }],
    }, context.waiter)).rejects.toMatchObject({
      response: { code: 'KITCHEN_TRANSITION_REQUIRES_GOVERNED_ENDPOINT' },
    });

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: context.order.id } }))
      .toMatchObject({ status: OrderTicketStatus.OPEN, revision: 0 });
    expect(await prisma.waiterOrderSyncReceipt.count({
      where: { clientMutationId: `p8-kitchen-bypass-${context.order.id}` },
    })).toBe(0);
  });

  it('rejects a privileged role without orders.update before reading the order', async () => {
    const context = await fixture(OrderTicketStatus.OPEN);
    const findUnique = jest.spyOn(prisma.orderTicket, 'findUnique');

    await expect(orders.transitionKitchen(
      context.order.id,
      { action: 'START_PREPARATION', expectedRevision: context.order.revision },
      context.adminWithoutPermission,
    )).rejects.toMatchObject({ response: { code: 'KITCHEN_TRANSITION_FORBIDDEN' } });

    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockRestore();
  });

  it.each([
    OrderTicketStatus.PAYMENT_PENDING,
    OrderTicketStatus.CANCELLED,
  ])('preserves generic transition to non-kitchen status %s', async (requested) => {
    const context = await fixture(OrderTicketStatus.OPEN);

    await expect(orders.update(
      context.order.id,
      { status: requested, expectedRevision: context.order.revision },
      context.admin,
    )).resolves.toMatchObject({ status: requested, revision: 1 });

    expect(await prisma.orderTicket.findUniqueOrThrow({ where: { id: context.order.id } }))
      .toMatchObject({ status: requested, revision: 1 });
  });
});
