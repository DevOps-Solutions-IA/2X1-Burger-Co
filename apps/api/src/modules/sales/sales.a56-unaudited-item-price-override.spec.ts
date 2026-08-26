import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { CashSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A56 (blind red team, round 5 pass 56) — FINDING (MEDIUM): `POST /sales` — the "separate manual-
 * discount feature" that A54/A55 explicitly flagged as out of scope
 * (`orders.a54-waiter-price-manipulation.spec.ts` header) — trusts `items[].unitPrice` completely
 * verbatim for EVERY role allowed to call the route, with NO audit trail of the override at all.
 *
 * CONTRAST WITH THE A54/A55 FIX (`OrdersService.buildOrderItems`, `orders.service.ts`): for
 * `POST /orders`, `PUT /orders/:id/items` and `POST /orders/waiter-sync`, a privileged operator
 * (admin/cashier/supervisor) overriding `item.unitPrice` away from `product.salePrice` is honored
 * AND unconditionally written to `AuditLog` (`action: 'ORDER_ITEM_PRICE_OVERRIDDEN'`, with actor,
 * product, catalog price and overridden price) — mirroring the existing
 * `deliveryFeeEdited`/`deliveryFeeEditReason` audit pattern.
 *
 * `SalesService.create` (`apps/api/src/modules/sales/sales.service.ts` ~line 679):
 *   `const unitPrice = toDecimal(item.unitPrice ?? Number(product.salePrice));`
 * has the IDENTICAL client-supplied-price shape, reachable by the SAME lowest-trust role allowed on
 * this route (`cashier`, per `@Roles('admin', 'cashier', 'supervisor')` on `SalesController.create`)
 * — but the resulting Sale/SaleItem is persisted with NO equivalent audit entry anywhere in the
 * creation transaction. `CreateSaleDto` also exposes a client-supplied `baseSubtotal`
 * (sales.service.ts ~788) from which `discount = baseSubtotal - adjustedSubtotal` is derived and
 * persisted on `Sale.discount` — again with no audit trail of who authorized the discount or why.
 *
 * This does not let an UNAUTHORIZED role move money (waiter still cannot reach `/sales` at all,
 * consistent with A55's finding that `orders.checkout`/`cash.*` gate this class of action). It DOES
 * violate the mission's stated financial-correctness invariant that "any privileged override must be
 * audited": a cashier can silently under-ring ANY item (or fabricate an arbitrarily large cosmetic
 * "discount" via `baseSubtotal`) through `/sales` and leave NONE of the accountability trail that the
 * near-identical `/orders` path was specifically hardened to always produce — defeating the very
 * loss-prevention/reconciliation review the A54/A55 audit mechanism exists for, via a sibling
 * endpoint that offers the identical capability.
 */
describe('A56 — POST /sales trusts item.unitPrice / baseSubtotal from a cashier with zero audit trail (unlike the audited /orders path)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A56 tests require an isolated _test database.');
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

  it('CONTROL: the sibling /orders path DOES audit a cashier price override (ORDER_ITEM_PRICE_OVERRIDDEN)', async () => {
    const seed = await seedTestData(prisma);
    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.0.1');

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'COUNTER',
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: 1 }],
      });
    expect(createResponse.status).toBe(201);

    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'orders',
        entity: 'order_ticket_item',
        action: 'ORDER_ITEM_PRICE_OVERRIDDEN',
        entityId: createResponse.body.id,
      },
    });
    expect(overrideAudit).not.toBeNull();
  });

  it('VULNERABLE: a cashier under-ringing an item to 1 COP via POST /sales leaves NO price-override audit trail anywhere', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);
    expect(realBurgerPrice).toBe(20000);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.1.1');

    const underRungPrice = 1; // vs. the real product.salePrice of 20000
    const createResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: seed.burger.id, quantity: 1, unitPrice: underRungPrice }],
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: underRungPrice }],
      });

    expect(createResponse.status).toBe(201);
    const saleId = createResponse.body.id as string;

    // The under-rung price IS trusted verbatim and persisted — confirming the unchecked-client-value
    // pattern is present here exactly as it was (pre-fix) on /orders.
    const persistedSale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    expect(Number(persistedSale.items[0]!.unitPrice)).toBe(underRungPrice);
    expect(Number(persistedSale.total)).toBe(underRungPrice);
    expect(Number(persistedSale.total)).not.toBe(realBurgerPrice);

    // THE GAP: unlike the /orders path (see the CONTROL test above), NOTHING in AuditLog records
    // that a cashier overrode this item's price 20000 -> 1. No entity-scoped audit row exists at
    // all for this sale beyond generic inventory-consumption bookkeeping — none of them mention the
    // override, the catalog price, or the overridden price.
    const anyAuditForThisSale = await prisma.auditLog.findMany({ where: { entityId: saleId } });
    const priceRelatedAudit = anyAuditForThisSale.find((entry) => {
      const action = entry.action.toUpperCase();
      const newValues = JSON.stringify(entry.newValues ?? {});
      return (
        action.includes('PRICE') ||
        action.includes('OVERRIDE') ||
        newValues.includes('catalogUnitPrice') ||
        newValues.includes('overriddenUnitPrice')
      );
    });
    expect(priceRelatedAudit).toBeUndefined();
  });

  it('VULNERABLE: a cashier can fabricate an arbitrarily large cosmetic "discount" via baseSubtotal with no audit of who/why', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.2.1');

    const fabricatedBaseSubtotal = 500000; // wildly inflated vs. the real 20000 item total
    const createResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        channel: 'MOSTRADOR',
        baseSubtotal: fabricatedBaseSubtotal,
        items: [{ productId: seed.burger.id, quantity: 1 }],
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: realBurgerPrice }],
      });

    expect(createResponse.status).toBe(201);
    const saleId = createResponse.body.id as string;
    const persistedSale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });

    // A fabricated ~96% "discount" was recorded on the permanent financial record with no
    // justification captured and no audit trail distinguishing it from a real, authorized discount.
    expect(Number(persistedSale.subtotal)).toBe(fabricatedBaseSubtotal);
    expect(Number(persistedSale.discount)).toBe(fabricatedBaseSubtotal - realBurgerPrice);

    const anyAuditForThisSale = await prisma.auditLog.findMany({ where: { entityId: saleId } });
    const discountRelatedAudit = anyAuditForThisSale.find((entry) => {
      const newValues = JSON.stringify(entry.newValues ?? {});
      return entry.action.toUpperCase().includes('DISCOUNT') || newValues.includes('baseSubtotal');
    });
    expect(discountRelatedAudit).toBeUndefined();
  });
});
