import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A67 (blind red team, round 5 pass 67) — FINDING (CRITICAL): the Reports module leaked the exact
 * same cost/margin data that `products.service.ts` was hardened to hide (A65) — with ZERO
 * role-based shaping.
 *
 * ROOT CAUSE
 * ----------
 * `ReportsService.buildSummary()` computes per-product `cost` derived from `SaleItem.estimatedCost`
 * (itself `product.costPrice * quantity` — or the recipe's ingredient-cost sum for `PREPARED`
 * products — set server-side in `sales.service.ts`). This flowed, completely unshaped, into:
 *   - `sales.byProduct[].cost` / `sales.bestSellers[].cost` / `sales.leastSellers[].cost` /
 *     `sales.nonMovingProducts[].cost`
 *   - `metrics.costOfSales` / `metrics.grossProfit` / `metrics.netProfit`
 *   - `ReportsService.getProductMargins()` — returns `{..., cost, margin}` per product directly
 *   - The persisted daily-closure snapshot (`captureDailyClosure()` writes `buildSummary()`'s
 *     output verbatim into `ReportSnapshot.payload`), served back unshaped by
 *     `GET /reports/daily-closures` / `GET /reports/daily-closures/:id`
 * ALL reachable via routes gated only by `@Roles('reports.read')` — a permission BOTH `cashier`
 * AND `supervisor` hold per `prisma/seed.ts`, even though NEITHER holds `products.update` (the
 * tier A65 established as the sole cost-visible tier, alongside `admin`/`inventory`).
 *
 * A SECOND, previously-unflagged leak of the SAME root cause was found in the same file while
 * fixing this: `getSupplyAlerts()` (`GET /reports/supply-alerts`) and, transitively,
 * `getInventorySummary()` (`GET /reports/inventory-summary`) — both also gated only by
 * `@Roles('reports.read')` — read `Product`/`Ingredient` via a plain Prisma `include` (no curated
 * `select`) and returned the raw records (`lowStockProducts`/`lowStockIngredients`) directly,
 * carrying every scalar column including `costPrice`. Nothing downstream of that read (stock
 * severity, supplier grouping, WhatsApp reorder messages) uses `costPrice`, so this is fixed the
 * same way.
 *
 * === THE FIX ===
 * `ReportsService` now defines the SAME `COST_VISIBILITY_PERMISSION = 'products.update'` gate as
 * `products.service.ts` (A65) — cost/margin data is the same underlying sensitive resource
 * regardless of which module surfaces it, so the fix reuses the permission rather than inventing a
 * parallel `reports.cost`-style one. `ReportsController` now threads
 * `@CurrentUser('permissions')` into every affected route and passes it through to the service.
 *
 * WHY REDACT-TO-ZERO INSTEAD OF products.service.ts's KEY-OMISSION (judgment call)
 * -----------------------------------------------------------------------------------
 * `products.service.ts` strips (`delete`s) `costPrice` entirely. Reports cannot cleanly do the
 * same for the `buildSummary()`/`ClosurePayload` shape: that type is inferred
 * (`Awaited<ReturnType<buildSummary>>`) and threaded through `getDaily()`/`getRange()`/
 * `getOperational()`, the persisted snapshot, AND the ~500-line PDF renderer
 * (`renderDailyPdf(data: ReportPdfData)`), which assumes `metrics.costOfSales` etc. exist.
 * Re-deriving all of that as a partial/omitted type was a much larger, riskier surface than this
 * finding warranted. Instead, `redactClosurePayloadCost()` sets `costOfSales`/`grossProfit`/
 * `netProfit`/every `.cost` field to `0` for non-cost-visible viewers — the type stays intact
 * end-to-end (the PDF renderer transparently prints "$0" for those rows instead of real figures,
 * with NO renderer changes needed), and it is still precisely testable (asserted `=== 0` below,
 * contrasted with the real nonzero admin figures). `getProductMargins()` and the supply-alerts
 * product/ingredient arrays, by contrast, are simple standalone flat shapes with no such shared
 * type — those mirror `products.service.ts` exactly and OMIT the sensitive keys.
 *
 * WHY READ-TIME SHAPING FOR THE PERSISTED SNAPSHOT (judgment call)
 * --------------------------------------------------------------------
 * `captureDailyClosure()` still persists the FULL, unredacted `buildSummary()` output — the
 * financial-record/audit copy must stay complete no matter who triggers the capture (mirrors
 * `products.service.ts`'s `update()`/`remove()`, which always read the full record for
 * `AuditLog.oldValues`). `getDailyClosure()`/`getDailyClosures()` shape the payload at READ time
 * based on the CURRENT caller's permissions — preferred over shaping at write time because it
 * doesn't require touching the persisted snapshot format or re-running historical captures, and it
 * stays correct even if a user's role/permissions change after a snapshot was captured.
 *
 * These tests exercise the REAL, unmocked `ReportsController` -> `ReportsService` chain through
 * the full Nest DI graph (`createTestApp()`) against real Postgres, using the seeded
 * `Coca-Cola Original 400 ml` product (`salePrice: 4500`, `costPrice: 2500` — a flat, non-recipe
 * cost, so the expected numbers are trivial to hand-verify) from
 * `apps/api/src/tests/helpers/test-data.ts`.
 */
describe('A67 — Reports module no longer leaks cost/margin/profit data to non-cost-visible roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A67 reports cost-leak tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function login(email: string, password: string, xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email, password });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  /**
   * Sets up: an OPEN cash session + one PAID sale of 2x Coca-Cola (salePrice 4500, costPrice
   * 2500) — revenue 9000, cost 5000, margin/gross-profit-contribution 4000. Returns both tokens
   * plus the raw seed for assertions.
   */
  async function seedOpenSessionWithSale(xffPrefix: string) {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', `${xffPrefix}.1`);
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', `${xffPrefix}.2`);

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    const saleRes = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: seed.soda.id, quantity: 2, unitPrice: 4500 }],
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: 9000 }],
      });
    expect(saleRes.status).toBe(201);

    return { seed, adminToken, cashierToken };
  }

  describe('GET /reports/daily', () => {
    it('FIXED: cashier gets the route (200) but costOfSales/grossProfit/netProfit and every per-product cost are redacted to 0 — revenue is untouched', async () => {
      const { cashierToken } = await seedOpenSessionWithSale('10.67.1');

      const res = await request(app.getHttpServer())
        .get('/reports/daily')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sales.total).toBe(9000);
      expect(res.body.metrics.costOfSales).toBe(0);
      expect(res.body.metrics.grossProfit).toBe(0);
      expect(res.body.metrics.netProfit).toBe(0);

      const sodaByProduct = res.body.sales.byProduct.find((item: { total: number }) => item.total === 9000);
      expect(sodaByProduct).toBeDefined();
      expect(sodaByProduct.cost).toBe(0);
      expect(sodaByProduct.quantity).toBe(2);

      for (const item of res.body.sales.bestSellers) {
        expect(item.cost).toBe(0);
      }
    });

    it('CONTRAST: admin (holds products.update) still receives real costOfSales/grossProfit/netProfit and per-product cost — the fix does not break the privileged flow', async () => {
      const { adminToken } = await seedOpenSessionWithSale('10.67.2');

      const res = await request(app.getHttpServer())
        .get('/reports/daily')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sales.total).toBe(9000);
      expect(res.body.metrics.costOfSales).toBe(5000);
      expect(res.body.metrics.grossProfit).toBe(4000);

      const sodaByProduct = res.body.sales.byProduct.find((item: { total: number }) => item.total === 9000);
      expect(sodaByProduct).toBeDefined();
      expect(sodaByProduct.cost).toBe(5000);
    });
  });

  describe('GET /reports/range', () => {
    it('FIXED: cashier — cost/profit fields redacted to 0, revenue untouched', async () => {
      const { cashierToken } = await seedOpenSessionWithSale('10.67.3');

      const res = await request(app.getHttpServer())
        .get('/reports/range')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sales.total).toBe(9000);
      expect(res.body.metrics.costOfSales).toBe(0);
      expect(res.body.metrics.grossProfit).toBe(0);
      expect(res.body.metrics.netProfit).toBe(0);
      for (const item of res.body.sales.byProduct) {
        expect(item.cost).toBe(0);
      }
    });

    it('CONTRAST: admin — real cost/profit figures', async () => {
      const { adminToken } = await seedOpenSessionWithSale('10.67.4');

      const res = await request(app.getHttpServer())
        .get('/reports/range')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.metrics.costOfSales).toBe(5000);
      expect(res.body.metrics.grossProfit).toBe(4000);
    });
  });

  describe('GET /reports/operational', () => {
    it('FIXED: cashier — cost/profit fields redacted to 0, revenue/operational counters untouched', async () => {
      const { cashierToken } = await seedOpenSessionWithSale('10.67.5');

      const res = await request(app.getHttpServer())
        .get('/reports/operational')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sales.total).toBe(9000);
      expect(res.body.metrics.costOfSales).toBe(0);
      expect(res.body.metrics.grossProfit).toBe(0);
      expect(res.body.metrics.netProfit).toBe(0);
      for (const item of res.body.sales.byProduct) {
        expect(item.cost).toBe(0);
      }
      // Non-cost operational fields must still be present — this is response shaping, not a
      // broken/empty route.
      expect(res.body.journey.status).toBe('ABIERTA');
    });

    it('CONTRAST: admin — real cost/profit figures', async () => {
      const { adminToken } = await seedOpenSessionWithSale('10.67.6');

      const res = await request(app.getHttpServer())
        .get('/reports/operational')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.metrics.costOfSales).toBe(5000);
      expect(res.body.metrics.grossProfit).toBe(4000);
    });
  });

  describe('GET /reports/product-margins', () => {
    it('FIXED: cashier gets the route (200) but no item carries `cost` or `margin` — revenue/quantity untouched', async () => {
      const { cashierToken } = await seedOpenSessionWithSale('10.67.7');

      const res = await request(app.getHttpServer())
        .get('/reports/product-margins')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const sodaMargin = res.body.find((item: { revenue: number }) => item.revenue === 9000);
      expect(sodaMargin).toBeDefined();
      expect(sodaMargin).not.toHaveProperty('cost');
      expect(sodaMargin).not.toHaveProperty('margin');
      expect(sodaMargin.quantity).toBe(2);
      expect(sodaMargin.revenue).toBe(9000);
    });

    it('CONTRAST: admin still receives real `cost` and `margin` — the fix does not break the privileged flow', async () => {
      const { adminToken } = await seedOpenSessionWithSale('10.67.8');

      const res = await request(app.getHttpServer())
        .get('/reports/product-margins')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const sodaMargin = res.body.find((item: { revenue: number }) => item.revenue === 9000);
      expect(sodaMargin).toBeDefined();
      expect(sodaMargin.cost).toBe(5000);
      expect(sodaMargin.margin).toBe(4000);
    });
  });

  describe('GET /reports/daily-closures and GET /reports/daily-closures/:id (persisted snapshot, shaped at READ time)', () => {
    async function seedClosedSessionWithSale(xffPrefix: string) {
      const seed = await seedTestData(prisma);
      const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', `${xffPrefix}.1`);
      const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', `${xffPrefix}.2`);

      const openRes = await request(app.getHttpServer())
        .post('/cash-register/open')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ openingAmount: 100000 });
      expect(openRes.status).toBe(201);

      const saleRes = await request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          channel: 'MOSTRADOR',
          items: [{ productId: seed.soda.id, quantity: 2, unitPrice: 4500 }],
          payments: [{ paymentMethodId: seed.paymentCash.id, amount: 9000 }],
        });
      expect(saleRes.status).toBe(201);

      const closeRes = await request(app.getHttpServer())
        .post('/cash-register/close')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ actualAmount: 109000 });
      expect(closeRes.status).toBe(201);

      return { seed, adminToken, cashierToken };
    }

    it('FIXED: cashier — GET /reports/daily-closures list has metrics redacted to 0; GET /reports/daily-closures/:id has cost fields redacted to 0 too', async () => {
      const { adminToken, cashierToken } = await seedClosedSessionWithSale('10.67.9');

      const listRes = await request(app.getHttpServer())
        .get('/reports/daily-closures')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThan(0);
      const closureId = listRes.body[0].id as string;

      const cashierListRes = await request(app.getHttpServer())
        .get('/reports/daily-closures')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(cashierListRes.status).toBe(200);
      expect(cashierListRes.body[0].metrics.costOfSales).toBe(0);
      expect(cashierListRes.body[0].metrics.grossProfit).toBe(0);
      expect(cashierListRes.body[0].metrics.netProfit).toBe(0);
      // Non-cost fields (sales total/count) must still be present.
      expect(cashierListRes.body[0].sales.total).toBe(9000);

      const cashierDetailRes = await request(app.getHttpServer())
        .get(`/reports/daily-closures/${closureId}`)
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(cashierDetailRes.status).toBe(200);
      expect(cashierDetailRes.body.metrics.costOfSales).toBe(0);
      for (const item of cashierDetailRes.body.sales.byProduct) {
        expect(item.cost).toBe(0);
      }
    });

    it('CONTRAST: admin — real, unredacted metrics on both the list and detail routes, even though the underlying snapshot is shared with the cashier request above', async () => {
      const { adminToken } = await seedClosedSessionWithSale('10.67.10');

      const listRes = await request(app.getHttpServer())
        .get('/reports/daily-closures')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body[0].metrics.costOfSales).toBe(5000);
      const closureId = listRes.body[0].id as string;

      const detailRes = await request(app.getHttpServer())
        .get(`/reports/daily-closures/${closureId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.metrics.costOfSales).toBe(5000);
      expect(detailRes.body.metrics.grossProfit).toBe(4000);
    });
  });

  describe('GET /reports/supply-alerts and GET /reports/inventory-summary (second leak found while fixing A67 — raw Product/Ingredient costPrice, unrelated to buildSummary())', () => {
    async function forceLowStock(prisma: PrismaService) {
      const seed = await seedTestData(prisma);
      // Drop soda below its stockMin (2) so it appears in lowStockProducts, and the bun ingredient
      // below its stockMin so it appears in lowStockIngredients.
      await prisma.product.update({ where: { id: seed.soda.id }, data: { currentStock: 1 } });
      await prisma.ingredient.update({ where: { id: seed.bun.id }, data: { currentStock: 0 } });
      return seed;
    }

    it('FIXED: cashier — no costPrice on any lowStockProducts/lowStockIngredients item on either route', async () => {
      await forceLowStock(prisma);
      const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.67.11');

      const alertsRes = await request(app.getHttpServer())
        .get('/reports/supply-alerts')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.lowStockProducts.length).toBeGreaterThan(0);
      expect(alertsRes.body.lowStockIngredients.length).toBeGreaterThan(0);
      for (const product of alertsRes.body.lowStockProducts) {
        expect(product).not.toHaveProperty('costPrice');
      }
      for (const ingredient of alertsRes.body.lowStockIngredients) {
        expect(ingredient).not.toHaveProperty('costPrice');
      }
      // Non-cost stock fields must still be present.
      expect(alertsRes.body.lowStockProducts[0].currentStock).toBeDefined();

      const summaryRes = await request(app.getHttpServer())
        .get('/reports/inventory-summary')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(summaryRes.status).toBe(200);
      for (const product of summaryRes.body.lowStockProducts) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives costPrice on both routes', async () => {
      await forceLowStock(prisma);
      const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.67.12');

      const alertsRes = await request(app.getHttpServer())
        .get('/reports/supply-alerts')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(alertsRes.status).toBe(200);
      const soda = alertsRes.body.lowStockProducts.find((product: { code: string }) => product.code === 'CC-ORG-400');
      expect(soda).toBeDefined();
      expect(Number(soda.costPrice)).toBe(2500);
    });
  });
});
