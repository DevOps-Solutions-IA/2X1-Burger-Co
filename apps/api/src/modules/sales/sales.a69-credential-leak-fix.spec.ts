import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — FINDING (CRITICAL, PoC-confirmed): `SalesService.findAll()`
 * used `include: { createdBy: true }` — an unshaped Prisma relation include — which fetches and
 * serializes the FULL `User` row into the JSON body of `GET /sales`, a route gated only by
 * `sales.read` (held by `cashier`). The full row includes `passwordHash`, `accessCodeHash`, and
 * `sessionVersion` for whoever created each sale (which can be `admin`, since admins can also
 * ring up sales) — meaning any authenticated cashier could recover the admin account's bcrypt
 * password hash and PIN-access-code hash straight out of the sales history response.
 *
 * `SalesService.findAll()`/`findOne()` also used `include: { items: { include: { product: true } } }`
 * — unshaped — which leaked `items[].product.costPrice` (supplier cost) to the same `cashier`
 * audience, the same class of finding already fixed for Products (A65) and Reports (A67).
 *
 * === THE FIX ===
 * `createdBy` is now `select`-shaped to `{ id, fullName, email }` — the same tier already used by
 * `CashRegisterService.history()`'s `openedBy`/`closedBy`/`reopenedBy` and
 * `InventoryService.findMovements()`'s `performedBy`. `costPrice` is stripped from every nested
 * `items[].product` via the same `COST_VISIBILITY_PERMISSION = 'products.update'` gate as
 * `products.service.ts`/`reports.service.ts`, threaded through `@CurrentUser('permissions')`.
 * `findOne()` never fetched `createdBy` in the first place, so only the cost leak applied there.
 *
 * These tests exercise the REAL, unmocked `SalesController` -> `SalesService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Sales module no longer leaks credential hashes or cost data to non-privileged roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 sales credential-leak tests require an isolated _test database.');
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

  /** OPEN session + one PAID sale of 2x Coca-Cola (salePrice 4500, costPrice 2500), created by
   * the admin account (so `createdBy` on the sale points at the highest-privilege user — the
   * worst-case leak target). Returns both tokens. */
  async function seedOpenSessionWithAdminSale(xffPrefix: string) {
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
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: seed.soda.id, quantity: 2, unitPrice: 4500 }],
        payments: [{ paymentMethodId: seed.paymentCash.id, amount: 9000 }],
      });
    expect(saleRes.status).toBe(201);

    return { seed, adminToken, cashierToken, saleId: saleRes.body.id as string };
  }

  describe('GET /sales', () => {
    it('FIXED: cashier response contains no passwordHash/accessCodeHash anywhere, and createdBy is shaped to {id, fullName, email}', async () => {
      const { cashierToken } = await seedOpenSessionWithAdminSale('10.69.1');

      const res = await request(app.getHttpServer())
        .get('/sales')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      const sale = res.body[0];
      expect(sale.createdBy).toBeDefined();
      expect(sale.createdBy.fullName).toBe('Admin Test');
      expect(Object.keys(sale.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
    });

    it('FIXED: cashier response strips costPrice from every items[].product, revenue untouched', async () => {
      const { cashierToken } = await seedOpenSessionWithAdminSale('10.69.2');

      const res = await request(app.getHttpServer())
        .get('/sales')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(Number(res.body[0].total)).toBe(9000);
      for (const item of res.body[0].items) {
        expect(item.product).not.toHaveProperty('costPrice');
        expect(item.product.name).toBeDefined();
      }
    });

    it('CONTRAST: admin (holds products.update) still receives real costPrice and the fix does not remove createdBy entirely', async () => {
      const { adminToken } = await seedOpenSessionWithAdminSale('10.69.3');

      const res = await request(app.getHttpServer())
        .get('/sales')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      expect(Number(res.body[0].items[0].product.costPrice)).toBe(2500);
      expect(res.body[0].createdBy.fullName).toBe('Admin Test');
    });
  });

  describe('GET /sales/:id', () => {
    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { cashierToken, saleId } = await seedOpenSessionWithAdminSale('10.69.4');

      const res = await request(app.getHttpServer())
        .get(`/sales/${saleId}`)
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      for (const item of res.body.items) {
        expect(item.product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice on the detail route', async () => {
      const { adminToken, saleId } = await seedOpenSessionWithAdminSale('10.69.5');

      const res = await request(app.getHttpServer())
        .get(`/sales/${saleId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });
});
