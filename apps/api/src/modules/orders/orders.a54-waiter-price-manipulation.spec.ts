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
 * A54 (blind red team, round 5 pass 54) — FINDING: financial-integrity gap in the
 * item-price contract shared by `POST /orders`, `PUT /orders/:id/items` and
 * `POST /orders/waiter-sync`.
 *
 * ROOT CAUSE
 * ----------
 * `CreateOrderTicketDto.items[].unitPrice` (apps/api/src/modules/orders/dto/create-order-ticket.dto.ts)
 * and `ReplaceOrderTicketItemsDto.items[].unitPrice`
 * (apps/api/src/modules/orders/dto/replace-order-ticket-items.dto.ts) both declare `unitPrice` as an
 * OPTIONAL, CLIENT-SUPPLIED number with only `@Min(0)` validation — no upper bound, no comparison
 * against the product's actual `salePrice`, and no additional `@Roles`/`@Permissions` gate beyond the
 * ordinary `orders.create` / `orders.update` permission that the LOWEST-trust order-management role
 * (`waiter`) already holds.
 *
 * `OrdersService.buildOrderItems()` (orders.service.ts ~L4092) is the single item-construction helper
 * shared by `create()`, `replaceItems()` and `syncWaiterOrder()`:
 *
 *   const unitPrice = toDecimal(item.unitPrice ?? product.salePrice);
 *
 * It trusts `item.unitPrice` verbatim whenever the caller supplies one, rather than always deriving
 * price from the canonical `product.salePrice`. The persisted `OrderTicketItem.unitPrice`/`totalPrice`
 * and the parent `OrderTicket.subtotal` are therefore directly attacker-controlled by ANY role that can
 * reach `create`/`replaceItems`/`waiter-sync` — which includes `waiter` (`orders.controller.ts` routes
 * `POST /orders`, `PUT /orders/:id/items`, `POST /orders/waiter-sync` all list `@Roles('admin',
 * 'cashier', 'supervisor', 'waiter')`). The seeded `waiter` role (prisma/seed.ts) deliberately does NOT
 * hold `orders.checkout`, `cash.*` or any discount/price-override permission — it is modeled as a
 * till-less, DINE_IN-table-only role. Yet it can single-handedly determine the exact amount the
 * business will later collect for that order's items.
 *
 * DOWNSTREAM IMPACT (checkout blindly trusts the persisted price)
 * -----------------------------------------------------------------
 * `OrdersService.checkout()` (orders.service.ts ~L3642) builds `salePayload.items` directly from
 * `current.items` (the ALREADY-PERSISTED, waiter-manipulated rows) with zero re-validation against
 * `product.salePrice`:
 *
 *   items: current.items.map((item) => ({ productId: item.productId, quantity: ..., unitPrice:
 *   toNumber(item.unitPrice), ... }))
 *
 * `SalesService.createInTransaction()` (sales.service.ts ~L679) repeats the same `item.unitPrice ??
 * product.salePrice` pattern on that already-tampered payload, and only asserts that the payments sum
 * to the (already fraudulent) `adjustedSubtotal` — never that `adjustedSubtotal` itself reflects real
 * product prices. The resulting `Sale.total`, `SalePayment.amount` and cash-drawer `CashMovement` are
 * all computed from the manipulated price. Compare this with the delivery-fee override path, which
 * DOES track manual overrides explicitly (`deliveryFeeEdited: boolean`, `deliveryFeeEditReason:
 * string`) — no equivalent audit trail exists for a per-item price override, so this is not a
 * documented/intentional "waiter can apply discounts" feature; it is an unflagged, unaudited gap.
 *
 * ATTACK SCENARIO
 * ----------------
 * 1. A `waiter`-role account (no cash/checkout authority) opens/edits a DINE_IN order for a table they
 *    are legitimately serving and submits `items: [{ productId: <Hamburguesa 2x1>, quantity: 1,
 *    unitPrice: 1 }]` instead of omitting `unitPrice` (which would default to the real
 *    `product.salePrice` = 20000 COP).
 * 2. The order is persisted with `subtotal = 1` instead of `20000`.
 * 3. A `cashier` later checks the same order out in perfect good faith, trusting the persisted
 *    subtotal on the register screen (which the frontend also derives from this same persisted value),
 *    and the sale is completed and the cash drawer only receives `1` COP for that item.
 *
 * This test proves the full chain against the REAL, unmocked `OrdersController` -> `OrdersService`,
 * real Postgres, and the real `ValidationPipe`/`RolesGuard`/`JwtAuthGuard` stack via full HTTP requests
 * through `createTestApp()` (not a hand-wired stub, not a mocked guard).
 */
describe('A54 — waiter-controlled item unitPrice bypasses product.salePrice and survives to checkout', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A54 price-manipulation tests require an isolated _test database.');
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

  it('FINDING: a waiter (no orders.checkout / cash.* permission) can set an arbitrary unitPrice on POST /orders, persisting a fraudulent subtotal far below product.salePrice', async () => {
    const seed = await seedTestData(prisma);

    // Real catalog price, straight from Postgres — the ground truth the attacker bypasses.
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

    // THE BUG: the server persisted the ATTACKER-SUPPLIED price instead of clamping/rejecting it or
    // falling back to product.salePrice.
    expect(Number(persistedItem!.unitPrice)).toBe(attackerUnitPrice);
    expect(Number(persistedItem!.totalPrice)).toBe(attackerUnitPrice);
    expect(Number(created.subtotal)).toBe(attackerUnitPrice);
    expect(Number(created.subtotal)).not.toBe(realBurgerPrice);

    // Confirm directly against Postgres too (not just the HTTP response projection).
    const dbOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
    expect(Number(dbOrder.subtotal)).toBe(attackerUnitPrice);
    expect(Number(dbOrder.items[0]!.unitPrice)).toBe(attackerUnitPrice);
  });

  it('FINDING (full financial chain): the waiter-manipulated price survives untouched through cashier checkout into the real Sale/payment records', async () => {
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

    // The cashier (a legitimately trusted, orders.checkout-holding role) checks the order out in good
    // faith, trusting the persisted subtotal exactly like the real POS screen would.
    const checkoutResponse = await request(app.getHttpServer())
      .post(`/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: attackerUnitPrice }],
      });

    expect(checkoutResponse.status).toBe(201);
    const saleId = checkoutResponse.body.sale.id as string;

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { items: true, payments: true },
    });

    // The REAL money collected/recorded for a 20000 COP burger was 1 COP — a complete, unaudited
    // bypass of `product.salePrice` by the lowest-trust order-management role in the system.
    expect(Number(sale.total)).toBe(attackerUnitPrice);
    expect(Number(sale.total)).not.toBe(realBurgerPrice);
    expect(Number(sale.items[0]!.unitPrice)).toBe(attackerUnitPrice);
    expect(Number(sale.payments[0]!.amount)).toBe(attackerUnitPrice);

    const closedOrder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: orderId } });
    expect(closedOrder.status).toBe(OrderTicketStatus.PAID);
    expect(Number(closedOrder.subtotal)).toBe(attackerUnitPrice);
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
});
