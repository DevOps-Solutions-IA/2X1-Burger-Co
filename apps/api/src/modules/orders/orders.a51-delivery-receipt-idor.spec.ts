import { hash } from 'bcryptjs';
import { ConflictException, type INestApplication } from '@nestjs/common';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { OrdersService } from './orders.service';

/**
 * A51 (blind red team, round 5 pass 51) — FINDING: IDOR on delivery-receipt read endpoints.
 *
 * ROOT CAUSE
 * ----------
 * `OrdersController` (apps/api/src/modules/orders/orders.controller.ts) exposes three routes to
 * the `delivery` role, keyed only by the order id in the URL, none of which accept
 * `@CurrentUser()` at all:
 *
 *   GET  :id/delivery-receipt          -> ordersService.generateCurrentDeliveryReceiptPdf(id)
 *   GET  :id/delivery-receipt-status   -> ordersService.getDeliveryReceiptStatus(id)
 *   GET  :id/delivery-receipt-history  -> ordersService.getDeliveryReceiptHistory(id)
 *
 * None of the three underlying `OrdersService` methods accept (or check) an `actor` at all — the
 * PDF/status/history are generated purely from `id`. This is inconsistent with every OTHER
 * delivery-role-accessible mutation on the same order (`claimDelivery`, `updateDeliveryWorkflow` /
 * `delivery-status`), which correctly route through `assertDeliveryWorkflowAccess()`
 * (orders.service.ts:1056) and throw `ConflictException` when the acting `delivery`-role user is
 * not `order.assignedRiderId`. The list endpoint `findDeliveryActive()` (orders.service.ts:764)
 * likewise correctly scopes what a `delivery`-role user is shown to
 * `assignedRiderId: actor.sub OR null` — proving the intended authorization model is
 * "a courier only touches their own (or unclaimed) deliveries". The three receipt-read routes are
 * simply missing that same ownership check, even though `Roles('delivery')` lets any
 * `delivery`-role account reach them for ANY order id, not just their own.
 *
 * BUSINESS / PII IMPACT
 * -----------------------
 * A `delivery`-role account (a courier account — an externally-facing, high-turnover role in a
 * fast-food delivery operation) can pull the full PDF receipt (customer name, delivery address,
 * phone, order items, payment method — CLAUDE.md section 17 PII), send-status, and full send
 * history for ANY delivery order in the system, including orders assigned to a DIFFERENT courier
 * or not yet claimed by anyone, by id alone — with zero ownership check, at the exact same
 * `@Roles` gate that correctly enforces ownership one route away. This is a direct RBAC/IDOR
 * violation of the invariant explicitly required for this pass ("Can a `delivery`-role account act
 * on a delivery order not assigned to them?").
 *
 * This test proves it against the REAL, unmocked `OrdersService` + real Postgres + the real
 * `assertDeliveryWorkflowAccess` ownership gate (exercised directly as a same-request contrast, not
 * mocked away), through the full Nest DI graph (`createTestApp()`), not a hand-wired stub.
 */
describe('A51 — delivery-receipt-status/-history IDOR (no ownership check for the `delivery` role)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A51 delivery-receipt IDOR tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    orders = app.get(OrdersService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  function authUserFor(user: { id: string; email: string; fullName: string }, roles: string[]): AuthUser {
    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: 0,
      roles,
      permissions: ['delivery.update'],
    };
  }

  it('a delivery-role account NOT assigned to an order can read its receipt status + history, while the identical order/actor pair is correctly REJECTED by the sibling ownership-checked delivery-workflow endpoint', async () => {
    const seed = await seedTestData(prisma);

    // A second, independent courier account — the actual assigned rider for the order under test.
    const deliveryRole = await prisma.role.findFirstOrThrow({ where: { name: 'delivery' } });
    const otherRider = await prisma.user.create({
      data: {
        email: 'other-rider-a51@2x1burgerco.local',
        fullName: 'Otro Domiciliario A51',
        passwordHash: await hash('OtherRider12345*', 12),
        roles: { create: [{ roleId: deliveryRole.id }] },
      },
    });

    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });

    // Order is assigned to `otherRider`, NOT to `seed.deliveryUser` (our attacking actor below).
    const order = await prisma.orderTicket.create({
      data: {
        number: `A51-IDOR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: otherRider.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
        deliveryWorkflowVersion: 0,
        customerName: 'Cliente Confidencial A51',
        customerPhone: '3011234567',
        deliveryReference: 'Torre 4, apto 501 - datos personales sensibles',
        deliveryFee: 0,
        subtotal: 45_000,
      },
    });

    // The attacker: an authenticated `delivery`-role account that is explicitly NOT the assigned
    // rider for this order.
    const attackerActor = authUserFor(seed.deliveryUser, ['delivery']);

    // --- Sibling ownership-checked endpoint correctly REJECTS this exact actor/order pair. ---
    await expect(
      orders.updateDeliveryWorkflow(
        order.id,
        { workflowStatus: DeliveryWorkflowStatus.IN_TRANSIT } as never,
        attackerActor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // --- VIOLATION: the receipt-status/-history routes have no ownership check at all and leak
    //     the other rider's assigned order's data (customer PII, send history) to this same
    //     unauthorized actor. Neither service method even accepts an actor parameter — proving
    //     the gap is structural (the controller never collects `@CurrentUser()` for these routes),
    //     not merely an unlucky missing `if`.
    const status = await orders.getDeliveryReceiptStatus(order.id);
    expect(status.orderId).toBe(order.id);
    expect(status.orderNumber).toBe(order.number);

    const history = await orders.getDeliveryReceiptHistory(order.id);
    expect(history).toBeTruthy();

    // Confirm the underlying service methods are (still, as of this round) actor-less by
    // construction — 1-arg signatures — which is exactly why the controller cannot pass an actor
    // through even if it wanted to without a signature change.
    expect(orders.getDeliveryReceiptStatus.length).toBe(1);
    expect(orders.getDeliveryReceiptHistory.length).toBe(1);
  });
});
