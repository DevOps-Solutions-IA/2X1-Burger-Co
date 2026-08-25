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
 * A53 — REMEDIATION.
 *
 * ROOT CAUSE (fixed in this pass)
 * --------------------------------
 * `OrdersController` (apps/api/src/modules/orders/orders.controller.ts) exposed three routes to
 * the `delivery` role, keyed only by the order id in the URL, none of which collected
 * `@CurrentUser()`:
 *
 *   GET  :id/delivery-receipt          -> ordersService.generateCurrentDeliveryReceiptPdf(id)
 *   GET  :id/delivery-receipt-status   -> ordersService.getDeliveryReceiptStatus(id)
 *   GET  :id/delivery-receipt-history  -> ordersService.getDeliveryReceiptHistory(id)
 *
 * None of the three underlying `OrdersService` methods accepted (or checked) an `actor` at all —
 * the PDF/status/history were generated purely from `id`. This was inconsistent with every OTHER
 * delivery-role-accessible mutation on the same order (`claimDelivery`, `updateDeliveryWorkflow` /
 * `delivery-status`), which correctly route through `assertDeliveryWorkflowAccess()`
 * (orders.service.ts) and throw `ConflictException` when the acting `delivery`-role user is not
 * `order.assignedRiderId`.
 *
 * FIX
 * ---
 * All three controller routes now collect `@CurrentUser() actor: AuthUser` and pass it through to
 * the corresponding `OrdersService` method, which now fetches `assignedRiderId` /
 * `assignedRider.fullName` and calls the SAME `assertDeliveryWorkflowAccess()` helper already used
 * by `claimDelivery()`/`updateDeliveryWorkflow()` — no parallel authorization mechanism was
 * invented. `allowClaim: true` is passed (matching `findDeliveryActive()`'s visibility rule of
 * `assignedRiderId: actor.sub OR null`) so a courier can still preview the receipt of an unclaimed
 * order before claiming it, but never another courier's already-assigned order.
 *
 * Staff roles (`admin`/`cashier`/`supervisor`) are exempt from the ownership check, exactly like
 * every sibling delivery route, because `assertDeliveryWorkflowAccess()` short-circuits via
 * `isPrivilegedOrderOperator()` before ever looking at `assignedRiderId`.
 *
 * This test proves it against the REAL, unmocked `OrdersService` + real Postgres + the real
 * `assertDeliveryWorkflowAccess` ownership gate, through the full Nest DI graph
 * (`createTestApp()`), not a hand-wired stub.
 */
describe('A51/A53 — delivery-receipt-status/-history/-pdf ownership enforcement for the `delivery` role', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A51/A53 delivery-receipt IDOR tests require an isolated _test database.');
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

  async function createAssignedDeliveryOrder(input: {
    prisma: PrismaService;
    createdById: string;
    assignedRiderId: string;
  }) {
    const cashSession = await input.prisma.cashSession.create({
      data: { openedById: input.createdById, openingAmount: 0 },
    });

    return input.prisma.orderTicket.create({
      data: {
        number: `A53-IDOR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: input.createdById,
        assignedRiderId: input.assignedRiderId,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
        deliveryWorkflowVersion: 0,
        customerName: 'Cliente Confidencial A51',
        customerPhone: '3011234567',
        deliveryReference: 'Torre 4, apto 501 - datos personales sensibles',
        deliveryFee: 0,
        subtotal: 45_000,
      },
    });
  }

  it('REGRESSION: a delivery-role account NOT assigned to an order is REJECTED from receipt status/history/pdf, matching the sibling ownership-checked delivery-workflow endpoint', async () => {
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

    // Order is assigned to `otherRider`, NOT to `seed.deliveryUser` (our attacking actor below).
    const order = await createAssignedDeliveryOrder({
      prisma,
      createdById: seed.adminUser.id,
      assignedRiderId: otherRider.id,
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

    // --- FIXED: the receipt-status/-history/-pdf routes now enforce the SAME ownership check and
    //     reject the unauthorized actor exactly like the sibling mutation route above. ---
    await expect(orders.getDeliveryReceiptStatus(order.id, attackerActor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(orders.getDeliveryReceiptHistory(order.id, attackerActor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      orders.generateCurrentDeliveryReceiptPdf(order.id, attackerActor),
    ).rejects.toBeInstanceOf(ConflictException);

    // The service methods now require an actor — the controller can no longer reach them without
    // one, closing the structural gap (no `@CurrentUser()` collected) that caused the original
    // finding.
    expect(orders.getDeliveryReceiptStatus.length).toBe(2);
    expect(orders.getDeliveryReceiptHistory.length).toBe(2);
    expect(orders.generateCurrentDeliveryReceiptPdf.length).toBe(2);
  });

  it('POSITIVE CONTROL: the ASSIGNED rider can still retrieve receipt status/history/pdf for their own order', async () => {
    const seed = await seedTestData(prisma);

    const order = await createAssignedDeliveryOrder({
      prisma,
      createdById: seed.adminUser.id,
      assignedRiderId: seed.deliveryUser.id,
    });

    const assignedActor = authUserFor(seed.deliveryUser, ['delivery']);

    const status = await orders.getDeliveryReceiptStatus(order.id, assignedActor);
    expect(status.orderId).toBe(order.id);
    expect(status.orderNumber).toBe(order.number);

    const history = await orders.getDeliveryReceiptHistory(order.id, assignedActor);
    expect(history).toBeTruthy();

    const pdf = await orders.generateCurrentDeliveryReceiptPdf(order.id, assignedActor);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: a delivery-role account can still preview receipt status/history/pdf for an UNCLAIMED order (parity with findDeliveryActive() visibility)', async () => {
    const seed = await seedTestData(prisma);

    const order = await createAssignedDeliveryOrder({
      prisma,
      createdById: seed.adminUser.id,
      assignedRiderId: seed.deliveryUser.id,
    });

    // Unassign it — simulates an order visible to any courier in findDeliveryActive() because
    // assignedRiderId is null.
    await prisma.orderTicket.update({ where: { id: order.id }, data: { assignedRiderId: null } });

    const unrelatedCourierActor = authUserFor(seed.deliveryUser, ['delivery']);

    const status = await orders.getDeliveryReceiptStatus(order.id, unrelatedCourierActor);
    expect(status.orderId).toBe(order.id);

    const history = await orders.getDeliveryReceiptHistory(order.id, unrelatedCourierActor);
    expect(history).toBeTruthy();
  });

  it('POSITIVE CONTROL: staff roles (admin/cashier/supervisor) retain unrestricted receipt access for ANY order, matching claimDelivery()/updateDeliveryWorkflow()\'s isPrivilegedOrderOperator() exemption', async () => {
    const seed = await seedTestData(prisma);

    const deliveryRole = await prisma.role.findFirstOrThrow({ where: { name: 'delivery' } });
    const someRider = await prisma.user.create({
      data: {
        email: 'staff-visibility-rider-a53@2x1burgerco.local',
        fullName: 'Domiciliario Staff Visibility A53',
        passwordHash: await hash('SomeRider12345*', 12),
        roles: { create: [{ roleId: deliveryRole.id }] },
      },
    });

    const order = await createAssignedDeliveryOrder({
      prisma,
      createdById: seed.adminUser.id,
      assignedRiderId: someRider.id,
    });

    const adminActor = authUserFor(seed.adminUser, ['admin']);

    // Staff is not the assigned rider, yet must still succeed — same policy as
    // updateDeliveryWorkflow()/claimDelivery() for privileged operators.
    const status = await orders.getDeliveryReceiptStatus(order.id, adminActor);
    expect(status.orderId).toBe(order.id);

    const history = await orders.getDeliveryReceiptHistory(order.id, adminActor);
    expect(history).toBeTruthy();

    const pdf = await orders.generateCurrentDeliveryReceiptPdf(order.id, adminActor);
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });
});
