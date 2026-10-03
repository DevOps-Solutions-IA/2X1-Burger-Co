import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A73/A74 (blind red-team, round 5 pass 73/74) — FINDING (CRITICAL, live PoC-confirmed by the
 * auditor): A69 fixed `items[].product.costPrice` leaking through `SalesService.findAll()`/
 * `findOne()` only. `POST /sales` (`SalesService.create()`) returned the raw `Sale` created by
 * `createInTransaction()` — same unshaped `include: { product: true }` — straight to any caller
 * holding the route's `@Roles('admin', 'cashier', 'supervisor')`, none of whom besides admin hold
 * `products.update`. The auditor's own PoC hit this exact route; the response value happened to
 * read `0` only because that test run's product had never been purchased with a nonzero cost —
 * the underlying code path is identical to the proven-leaking `/orders` one, which is why this
 * suite deliberately uses `soda` (a DIRECT_STOCK product with an explicit nonzero `costPrice`
 * of 2500 in `seedTestData`) to make the leak assert on a real nonzero value.
 *
 * === EXHAUSTIVE SWEEP (beyond the named finding) ===
 * While fixing the named `create()` leak in this same file, two more mutation endpoints in
 * `SalesService` were found returning the exact same unshaped-`include` shape (this time
 * embedding an `OrderTicket`, not a `Sale`, but the leaked field is the identical
 * `items[].product.costPrice`):
 *   - `POST /sales/:id/convert-to-order` (`convertToOrder()`)
 *   - `POST /sales/:id/reopen-converted-order` (`reopenConvertedOrder()`)
 * Both are fixed here too, reusing the exact same `canViewCost()`/`stripSaleCost()` gate (the
 * check is structural — `{ items: [{ product: { costPrice } }] }` — not `Sale`-specific).
 *
 * These tests exercise the REAL, unmocked `SalesController` -> `SalesService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A73/A74 — Sales module no longer leaks costPrice through mutation endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let loginAttempt = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A73/A74 sales mutation-cost-leak tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    loginAttempt = 0;
  });

  async function login(email: string, password: string) {
    loginAttempt += 1;
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', `10.74.${loginAttempt}.1`)
      .send({ email, password });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function seedContext() {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*');
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*');

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    return { seed, adminToken, cashierToken };
  }

  function findItemsProducts(entity: { items: Array<{ product: Record<string, unknown> }> }) {
    return entity.items.map((item) => item.product);
  }

  describe('POST /sales (create) — named finding', () => {
    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { seed, cashierToken } = await seedContext();

      const res = await request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          channel: 'MOSTRADOR',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
          payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }],
        });

      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body)).not.toContain('costPrice');
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
        expect(product.name).toBeDefined();
      }
      expect(Number(res.body.total)).toBe(4500);
    });

    it('CONTRAST: admin (holds products.update) still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();

      const res = await request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'MOSTRADOR',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
          payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }],
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /sales/:id/convert-to-order — exhaustive-sweep finding', () => {
    async function seedPaidSale(actorToken: string, seed: Awaited<ReturnType<typeof seedTestData>>) {
      const saleRes = await request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({
          channel: 'MOSTRADOR',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
          payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }],
        });
      expect(saleRes.status).toBe(201);
      return saleRes.body.id as string;
    }

    it('FIXED: cashier response strips costPrice from the newly created orderTicket.items[].product', async () => {
      const { seed, adminToken, cashierToken } = await seedContext();
      const saleId = await seedPaidSale(adminToken, seed);

      const res = await request(app.getHttpServer())
        .post(`/sales/${saleId}/convert-to-order`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ type: 'COUNTER', reason: 'Cliente pidio pasar a comanda' });

      expect(res.status).toBe(201);
      expect(res.body.orderTicket).toBeDefined();
      for (const product of findItemsProducts(res.body.orderTicket)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();
      const saleId = await seedPaidSale(adminToken, seed);

      const res = await request(app.getHttpServer())
        .post(`/sales/${saleId}/convert-to-order`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'COUNTER', reason: 'Cliente pidio pasar a comanda' });

      expect(res.status).toBe(201);
      expect(Number(res.body.orderTicket.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /sales/:id/reopen-converted-order — exhaustive-sweep finding', () => {
    async function seedConvertedAndFinalizedSale(
      actorToken: string,
      seed: Awaited<ReturnType<typeof seedTestData>>,
    ) {
      const saleRes = await request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({
          channel: 'MOSTRADOR',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
          payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }],
        });
      expect(saleRes.status).toBe(201);
      const originalSaleId = saleRes.body.id as string;

      const convertRes = await request(app.getHttpServer())
        .post(`/sales/${originalSaleId}/convert-to-order`)
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ type: 'COUNTER', reason: 'Cliente pidio pasar a comanda' });
      expect(convertRes.status).toBe(201);
      const orderId = convertRes.body.orderTicket.id as string;

      const checkoutRes = await request(app.getHttpServer())
        .post(`/orders/${orderId}/checkout`)
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }] });
      expect(checkoutRes.status).toBe(201);

      // `reopenConvertedOrder` reopens from the ORIGINAL sale that was converted, not the final
      // one created by checkout — see SalesService.reopenConvertedOrder()'s `sourceSale`/
      // `conversion` lookup.
      return originalSaleId;
    }

    it('FIXED: cashier response strips costPrice from the restored orderTicket.items[].product', async () => {
      const { seed, adminToken, cashierToken } = await seedContext();
      const originalSaleId = await seedConvertedAndFinalizedSale(adminToken, seed);

      const res = await request(app.getHttpServer())
        .post(`/sales/${originalSaleId}/reopen-converted-order`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ reason: 'Reversa por error de digitacion' });

      expect(res.status).toBe(201);
      expect(res.body.orderTicket).toBeDefined();
      for (const product of findItemsProducts(res.body.orderTicket)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();
      const originalSaleId = await seedConvertedAndFinalizedSale(adminToken, seed);

      const res = await request(app.getHttpServer())
        .post(`/sales/${originalSaleId}/reopen-converted-order`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Reversa por error de digitacion' });

      expect(res.status).toBe(201);
      expect(Number(res.body.orderTicket.items[0].product.costPrice)).toBe(2500);
    });
  });
});
