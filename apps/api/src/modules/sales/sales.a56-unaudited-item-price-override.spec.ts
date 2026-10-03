import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { CashSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A56 (blind red team, round 5 pass 56) — FINDING (MEDIUM), CLOSED by A58: `POST /sales` — the
 * "separate manual-discount feature" that A54/A55 explicitly flagged as out of scope
 * (`orders.a54-waiter-price-manipulation.spec.ts` header) — trusted `items[].unitPrice` completely
 * verbatim for EVERY role allowed to call the route, with NO audit trail of the override at all.
 *
 * CONTRAST WITH THE A54/A55 FIX (`OrdersService.buildOrderItems`, `orders.service.ts`): for
 * `POST /orders`, `PUT /orders/:id/items` and `POST /orders/waiter-sync`, a privileged operator
 * (admin/cashier/supervisor) overriding `item.unitPrice` away from `product.salePrice` is honored
 * AND unconditionally written to `AuditLog` (`action: 'ORDER_ITEM_PRICE_OVERRIDDEN'`, with actor,
 * product, catalog price and overridden price) — mirroring the existing
 * `deliveryFeeEdited`/`deliveryFeeEditReason` audit pattern.
 *
 * Before A58, `SalesService.createInTransaction` (`apps/api/src/modules/sales/sales.service.ts`)
 * had the IDENTICAL client-supplied-price shape, reachable by the SAME lowest-trust role allowed on
 * this route (`cashier`, per `@Roles('admin', 'cashier', 'supervisor')` on `SalesController.create`)
 * — but the resulting Sale/SaleItem was persisted with NO equivalent audit entry anywhere in the
 * creation transaction. `CreateSaleDto` also exposes a client-supplied `baseSubtotal` from which
 * `discount = baseSubtotal - adjustedSubtotal` is derived and persisted on `Sale.discount` — again
 * with no audit trail of who authorized the discount or why.
 *
 * This never let an UNAUTHORIZED role move money (waiter still cannot reach `/sales` at all,
 * consistent with A55's finding that `orders.checkout`/`cash.*` gate this class of action). It DID
 * violate the mission's stated financial-correctness invariant that "any privileged override must be
 * audited": a cashier could silently under-ring ANY item (or fabricate an arbitrarily large cosmetic
 * "discount" via `baseSubtotal`) through `/sales` and leave NONE of the accountability trail that the
 * near-identical `/orders` path was specifically hardened to always produce.
 *
 * === A58 FIX ===
 * `SalesService.createInTransaction` now mirrors `OrdersService.buildOrderItems` /
 * `auditItemPriceOverrides` exactly in spirit, reusing the SAME generic `AuditService`/`AuditLog`
 * mechanism (no new column, no new migration):
 *   - `auditSaleItemPriceOverrides` writes one `AuditLog` row per item whose submitted `unitPrice`
 *     diverges from `product.salePrice` — `action: 'SALE_ITEM_PRICE_OVERRIDDEN'`,
 *     `module: 'sales'`, `entity: 'sale_item'`, `entityId: <saleId>`, with actor (`userId`,
 *     `actorRole`), `productId`, `productName`, `catalogUnitPrice`, `overriddenUnitPrice`.
 *   - `auditSaleDiscountIfDiverged` writes one `AuditLog` row whenever the client-supplied
 *     `baseSubtotal` diverges upward from the server-computed subtotal (`itemsSubtotal +
 *     deliveryFee`) — `action: 'SALE_DISCOUNT_APPLIED'`, `module: 'sales'`, `entity: 'sale'`,
 *     `entityId: <saleId>`, with actor, `computedSubtotal`, `submittedBaseSubtotal`,
 *     `discountAmount`.
 * Both writes happen inside the SAME database transaction as the sale creation, so the audit trail
 * can never be missing for a persisted override. WHO can submit an override is unchanged
 * (admin/cashier/supervisor remain authorized) — only whether it is now always recorded.
 */
describe('A56/A58 — POST /sales item-price override and baseSubtotal-derived discount are now audited (mirrors the /orders ORDER_ITEM_PRICE_OVERRIDDEN pattern)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A56/A58 tests require an isolated _test database.');
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

  it('FIXED: a cashier under-ringing an item to 1 COP via POST /sales now leaves a SALE_ITEM_PRICE_OVERRIDDEN audit trail', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);
    expect(realBurgerPrice).toBe(20000);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.1.1');
    const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@2x1burgerco.local' } });

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

    // The under-rung price is still honored (admin/cashier/supervisor legitimately hold
    // price-override authority on this endpoint — the fix does not block it) and persisted exactly
    // as before.
    const persistedSale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    expect(Number(persistedSale.items[0]!.unitPrice)).toBe(underRungPrice);
    expect(Number(persistedSale.total)).toBe(underRungPrice);
    expect(Number(persistedSale.total)).not.toBe(realBurgerPrice);

    // THE FIX: unlike before A58, an accountable SALE_ITEM_PRICE_OVERRIDDEN row now exists,
    // mirroring the /orders path's ORDER_ITEM_PRICE_OVERRIDDEN CONTROL above, with correct
    // actor/before/after values.
    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'sales',
        entity: 'sale_item',
        action: 'SALE_ITEM_PRICE_OVERRIDDEN',
        entityId: saleId,
      },
    });
    expect(overrideAudit).not.toBeNull();
    expect(overrideAudit!.userId).toBe(cashier.id);
    expect(overrideAudit!.actorRole).toBe('cashier');
    const after = overrideAudit!.newValues as Record<string, unknown>;
    expect(after.productId).toBe(seed.burger.id);
    expect(after.catalogUnitPrice).toBe(realBurgerPrice);
    expect(after.overriddenUnitPrice).toBe(underRungPrice);
  });

  it('FIXED: a cashier ringing an item at catalog price via POST /sales produces NO price-override audit noise', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.1.2');

    const createResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: seed.burger.id, quantity: 1 }],
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: realBurgerPrice }],
      });

    expect(createResponse.status).toBe(201);
    const saleId = createResponse.body.id as string;

    const overrideAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'sales',
        entity: 'sale_item',
        action: 'SALE_ITEM_PRICE_OVERRIDDEN',
        entityId: saleId,
      },
    });
    expect(overrideAudit).toBeNull();

    const discountAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'sales',
        entity: 'sale',
        action: 'SALE_DISCOUNT_APPLIED',
        entityId: saleId,
      },
    });
    expect(discountAudit).toBeNull();
  });

  it('FIXED: a cashier fabricating an arbitrarily large cosmetic "discount" via baseSubtotal now leaves a SALE_DISCOUNT_APPLIED audit trail', async () => {
    const seed = await seedTestData(prisma);
    const realBurgerPrice = Number(seed.burger.salePrice);

    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.7.2.1');
    const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@2x1burgerco.local' } });

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

    // The discount is still honored on the permanent financial record exactly as before (the fix
    // does not block a legitimate discount) — but now it is accountable.
    expect(Number(persistedSale.subtotal)).toBe(fabricatedBaseSubtotal);
    expect(Number(persistedSale.discount)).toBe(fabricatedBaseSubtotal - realBurgerPrice);

    const discountAudit = await prisma.auditLog.findFirst({
      where: {
        module: 'sales',
        entity: 'sale',
        action: 'SALE_DISCOUNT_APPLIED',
        entityId: saleId,
      },
    });
    expect(discountAudit).not.toBeNull();
    expect(discountAudit!.userId).toBe(cashier.id);
    expect(discountAudit!.actorRole).toBe('cashier');
    const after = discountAudit!.newValues as Record<string, unknown>;
    expect(after.computedSubtotal).toBe(realBurgerPrice);
    expect(after.submittedBaseSubtotal).toBe(fabricatedBaseSubtotal);
    expect(after.discountAmount).toBe(fabricatedBaseSubtotal - realBurgerPrice);
  });
});
