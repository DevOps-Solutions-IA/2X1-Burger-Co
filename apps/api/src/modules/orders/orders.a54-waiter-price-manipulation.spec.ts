import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { CashSessionStatus, OrderTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import {
  resetDatabase,
  seedTestData,
  WAITER_ACCESS_NAME,
  WAITER_ACCESS_CODE,
} from '../../tests/helpers/test-data';

/**
 * A54 (blind red team, round 5 pass 54) — ORIGINAL FINDING (CRITICAL): financial-integrity gap in
 * the item-price contract shared by `POST /orders`, `PUT /orders/:id/items` and
 * `POST /orders/waiter-sync`.
 *
 * ROOT CAUSE (as found)
 * ----------------------
 * `CreateOrderTicketDto.items[].unitPrice` and `ReplaceOrderTicketItemsDto.items[].unitPrice` both
 * declared `unitPrice` as an OPTIONAL, CLIENT-SUPPLIED number with only `@Min(0)` validation — no
 * comparison against `product.salePrice`, no additional authorization beyond the ordinary
 * `orders.create`/`orders.update` permission the `waiter` role already holds.
 * `OrdersService.buildOrderItems()` trusted `item.unitPrice` verbatim whenever the caller supplied
 * one: `const unitPrice = toDecimal(item.unitPrice ?? product.salePrice);`. Because `waiter` is
 * listed in `@Roles('admin', 'cashier', 'supervisor', 'waiter')` on all three routes, and
 * deliberately holds no `orders.checkout`/`cash.*`/discount permission, it could unilaterally set
 * any item's persisted, later-checked-out price to anything (down to 0) — a complete, unaudited
 * bypass of `product.salePrice` that survived untouched into `Sale`/`SalePayment`/`CashMovement`.
 *
 * A55 CLOSURE (this file, now a PERMANENT regression suite)
 * ------------------------------------------------------------
 * Investigation (A55) confirmed a LEGITIMATE existing use of client-supplied `unitPrice`: the POS
 * screen (`apps/web/src/app/(app)/pos/page.tsx`, `updateItemPrice`) lets a PRIVILEGED operator
 * (admin/cashier/supervisor — never waiter) manually override an item's price before
 * create/replaceItems, through the SAME shared DTO field. No test, and no other caller, relied on
 * a NON-privileged role being able to set `unitPrice`. No discount/price-override permission
 * existed anywhere in `prisma/seed.ts`.
 *
 * The fix (`OrdersService.buildOrderItems`, `orders.service.ts`) therefore gates trust in
 * `item.unitPrice` behind `isPrivilegedOrderOperator(actor)` — the SAME admin/cashier/supervisor
 * vs. waiter boundary already used elsewhere in this file:
 *   - `waiter` (or any non-privileged role): `item.unitPrice` is ALWAYS ignored. The persisted
 *     price is unconditionally `product.salePrice`, regardless of what the client submits.
 *   - `admin`/`cashier`/`supervisor`: `item.unitPrice` is honored when present (preserves the real
 *     POS manual-price-override feature), and every actual override (submitted price differs from
 *     `product.salePrice`) is written to `AuditLog` (`action: 'ORDER_ITEM_PRICE_OVERRIDDEN'`) with
 *     actor, product, catalog price and overridden price — mirroring the
 *     `deliveryFeeEdited`/`deliveryFeeEditReason` audit pattern used for delivery-fee overrides,
 *     without requiring any new persisted column/migration.
 *
 * `createFromCanonicalCheckout` (SOFIA canonical checkout confirmation) keeps trusting its
 * `itemSnapshots` unconditionally — that price is already server-derived from
 * `product.persistedPrice` at draft time (`SofiaService.buildItemsSnapshot`), never raw client
 * input, and is independently cross-checked against `checkout.total`
 * (`CHECKOUT_PRICE_CHANGED` on mismatch).
 */
describe('A54/A55 — item unitPrice trust is gated to privileged operators, waiter can never undercut product.salePrice', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A54/A55 price-manipulation tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function login(email: string, password: string, ip: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function waiterLogin(ip: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', ip)
      .send({ name: WAITER_ACCESS_NAME, accessCode: WAITER_ACCESS_CODE });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  it('CLOSED: a waiter (no orders.checkout / cash.* permission) submitting a manipulated unitPrice on POST /orders is silently ignored — server persists product.salePrice, not the attacker value', async () => {
    const seed = await seedTestData(prisma);

    // Real catalog price, straight from Postgres — the ground truth the attacker tried to bypass.
    const realBurgerPrice = Number(seed.burger.salePrice);
    expect(realBurgerPrice).toBe(20000);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });

    const waiterToken = await waiterLogin('10.0.1.1');

    const attackerUnitPrice = 1; // vs. the real product.salePrice of 20000
    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: seed.tableOne.id,
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: attackerUnitPrice }],
      });

    expect(createResponse.status).toBe(201);
    const created = createResponse.body as {
      id: string;
      subtotal: string | number;
      items: Array<{ unitPrice: string | number; totalPrice: string | number; productId: string }>;
    };

    const persistedItem = created.items.find((item) => item.productId === seed.burger.id);
    expect(persistedItem).toBeDefined();

    // THE FIX: the server ignores the attacker-supplied price entirely and always derives it from
    // product.salePrice for a non-privileged actor.
    expect(Number(persistedItem!.unitPrice)).toBe(realBurgerPrice);
    expect(Number(persistedItem!.totalPrice)).toBe(realBurgerPrice);
    expect(Number(created.subtotal)).toBe(realBurgerPrice);
    expect(Number(created.subtotal)).not.toBe(attackerUnitPrice);

    // Confirm directly against Postgres too (not just the HTTP response projection).
    const dbOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
    expect(Number(dbOrder.subtotal)).toBe(realBurgerPrice);
    expect(Number(dbOrder.items[0]!.unitPrice)).toBe(realBurgerPrice);

    // No item-price-override audit entry should exist for a non-privileged actor: there was no
    // override, because the client-supplied value was never trusted in the first place.
    const overrideAudit = await prisma.auditLog.findFirst({
      where: { module: 'orders', entity: 'order_ticket_item', action: 'ORDER_ITEM_PRICE_OVERRIDDEN', entityId: created.id },
    });
    expect(overrideAudit).toBeNull();
  });

  it('CLOSED (full financial chain): a waiter-attempted price manipulation never reaches Sale/payment records — checkout charges the real product.salePrice', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });

    const waiterToken = await waiterLogin('10.0.2.1');
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.0.2.2');

    const attackerUnitPrice = 1;
    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: seed.tableOne.id,
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: attackerUnitPrice }],
      });
    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.id as string;
    // The order was persisted with the REAL price, not the attacker's 1 COP.
    expect(Number(createResponse.body.subtotal)).toBe(realBurgerPrice);

    // A cashier attempting to under-collect (trusting the OLD, now-impossible attacker value) is
    // correctly rejected: the persisted subtotal is the real price, so a 1 COP payment no longer
    // balances the order.
    const underpaidCheckout = await request(app.getHttpServer())
      .post(`/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: attackerUnitPrice }],
      });
    expect(underpaidCheckout.status).toBe(400);

    // Checking out with the REAL price succeeds and collects the REAL amount.
    const checkoutResponse = await request(app.getHttpServer())
      .post(`/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: realBurgerPrice }],
      });

    expect(checkoutResponse.status).toBe(201);
    const saleId = checkoutResponse.body.sale.id as string;

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { items: true, payments: true },
    });

    // The REAL money collected/recorded for the 20000 COP burger is 20000, never the attacker's 1.
    expect(Number(sale.total)).toBe(realBurgerPrice);
    expect(Number(sale.total)).not.toBe(attackerUnitPrice);
    expect(Number(sale.items[0]!.unitPrice)).toBe(realBurgerPrice);
    expect(Number(sale.payments[0]!.amount)).toBe(realBurgerPrice);

    const closedOrder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: orderId } });
    expect(closedOrder.status).toBe(OrderTicketStatus.PAID);
    expect(Number(closedOrder.subtotal)).toBe(realBurgerPrice);
  });

  it('POSITIVE CONTROL: omitting unitPrice correctly falls back to the real product.salePrice for the same waiter/table/order shape', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });

    const waiterToken = await waiterLogin('10.0.3.1');

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: seed.tableOne.id,
        items: [{ productId: seed.burger.id, quantity: 1 }],
      });

    expect(createResponse.status).toBe(201);
    expect(Number(createResponse.body.subtotal)).toBe(realBurgerPrice);
  });

  it('LEGITIMATE USE PRESERVED: a privileged operator (cashier) manually overriding an item price on POST /orders still works, and the override is audited', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });

    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.0.4.1');

    const managerApprovedPrice = 15000; // e.g. a manager-approved discount on this item
    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'COUNTER',
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: managerApprovedPrice }],
      });

    expect(createResponse.status).toBe(201);
    const created = createResponse.body as {
      id: string;
      subtotal: string | number;
      items: Array<{ unitPrice: string | number; productId: string }>;
    };
    const persistedItem = created.items.find((item) => item.productId === seed.burger.id);

    // A privileged operator's manual override IS honored — this is the real POS feature, not a
    // vulnerability, and must keep working.
    expect(Number(persistedItem!.unitPrice)).toBe(managerApprovedPrice);
    expect(Number(persistedItem!.unitPrice)).not.toBe(realBurgerPrice);
    expect(Number(created.subtotal)).toBe(managerApprovedPrice);

    // ...but it is never silent: the override is written to AuditLog, mirroring the
    // deliveryFeeEdited/deliveryFeeEditReason pattern used for delivery-fee overrides.
    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'orders',
        entity: 'order_ticket_item',
        action: 'ORDER_ITEM_PRICE_OVERRIDDEN',
        entityId: created.id,
      },
    });
    expect(overrideAudit).not.toBeNull();
    expect((overrideAudit!.newValues as Record<string, unknown>).catalogUnitPrice).toBe(realBurgerPrice);
    expect((overrideAudit!.newValues as Record<string, unknown>).overriddenUnitPrice).toBe(managerApprovedPrice);
    expect((overrideAudit!.newValues as Record<string, unknown>).productId).toBe(seed.burger.id);
  });

  it('CLOSED (waiter-sync path): the third reachable caller of buildOrderItems() — POST /orders/waiter-sync — also ignores a waiter-supplied unitPrice and persists product.salePrice', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });

    const waiterToken = await waiterLogin('10.0.5.1');

    const attackerUnitPrice = 1;
    const syncResponse = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: seed.tableOne.id,
        status: 'OPEN',
        clientMutationId: 'a55-waiter-sync-price-attack-1',
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: attackerUnitPrice }],
      });

    expect(syncResponse.status).toBe(201);
    expect(Number(syncResponse.body.subtotal)).toBe(realBurgerPrice);
    expect(Number(syncResponse.body.subtotal)).not.toBe(attackerUnitPrice);

    const dbOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: syncResponse.body.id },
      include: { items: true },
    });
    expect(Number(dbOrder.subtotal)).toBe(realBurgerPrice);
    expect(Number(dbOrder.items[0]!.unitPrice)).toBe(realBurgerPrice);

    // Re-sync (update path, `current` branch of syncWaiterOrder) with a second manipulation
    // attempt — also ignored.
    const resyncResponse = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        orderId: dbOrder.id,
        tableId: seed.tableOne.id,
        status: 'OPEN',
        expectedRevision: dbOrder.revision,
        clientMutationId: 'a55-waiter-sync-price-attack-2',
        items: [{ productId: seed.burger.id, quantity: 2, unitPrice: 1 }],
      });

    expect(resyncResponse.status).toBe(201);
    expect(Number(resyncResponse.body.subtotal)).toBe(realBurgerPrice * 2);
  });
});
