import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — FINDING (CRITICAL, PoC-confirmed): the shared
 * `orderInclude` object in `orders.service.ts` (reused at ~30 call sites throughout the file:
 * `findAll()`, `findOne()`, `create()`, checkout, kitchen transitions, delivery assignment, etc.)
 * used `createdBy: true` — an unshaped Prisma relation include — which fetches and serializes the
 * FULL `User` row into every JSON response built from it, including `GET /orders`, a route gated
 * only by `@Roles('admin', 'cashier', 'supervisor')`. The full row includes `passwordHash`,
 * `accessCodeHash`, and `sessionVersion` for whoever created each order (which can be `admin`) —
 * meaning any authenticated cashier could recover the admin account's bcrypt password hash and
 * PIN-access-code hash straight out of the order list/detail response. Fixing the ONE shared
 * `orderInclude` definition fixes the credential leak at every one of those ~30 call sites at once.
 *
 * By contrast, `orderInclude.assignedWaiter`/`assignedRider` were ALREADY correctly shaped with a
 * curated `select` — this suite asserts that established-safe behavior too, as a regression guard.
 *
 * `orderInclude.items.product` was also unshaped (`include: { category: true }`), leaking
 * `costPrice` (supplier cost) to the same `cashier` audience on `findAll()`/`findOne()` — the same
 * class of finding already fixed for Products (A65), Reports (A67), and Sales (A69, this same
 * round).
 *
 * === THE FIX ===
 * `orderInclude.createdBy` is now `select`-shaped to `{ id, fullName, accessName }` — mirroring
 * the SAME shape already used two lines below for `assignedWaiter` in the same object (an order's
 * creator can be a PIN-login waiter just as easily as an email/password admin/cashier, so
 * `accessName` is relevant here, unlike the email/password-only modules fixed alongside this one).
 * `costPrice` is stripped from every nested `items[].product` in `findAll()`/`findOne()` — the
 * list/detail read surface reported in this finding — via the same
 * `ORDER_COST_VISIBILITY_PERMISSION = 'products.update'` gate as the other modules, threaded
 * through `@CurrentUser('permissions')`.
 *
 * These tests exercise the REAL, unmocked `OrdersController` -> `OrdersService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Orders module no longer leaks credential hashes or cost data to non-privileged roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 orders credential-leak tests require an isolated _test database.');
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

  /** Admin creates a COUNTER order for 2x Coca-Cola (salePrice 4500, costPrice 2500) — the order's
   * `createdBy` therefore points at the highest-privilege user (worst-case leak target), and its
   * `assignedWaiter`/`assignedRider` stay null (unassigned), which is fine — the regression guard
   * only needs to confirm those fields' select shape is not weakened by this fix, not that they're
   * populated. */
  async function seedAdminCreatedOrder(xffPrefix: string) {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', `${xffPrefix}.1`);
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', `${xffPrefix}.2`);

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'COUNTER',
        items: [{ productId: seed.soda.id, quantity: 2, unitPrice: 4500 }],
      });
    expect(createRes.status).toBe(201);

    return { seed, adminToken, cashierToken, orderId: createRes.body.id as string };
  }

  describe('GET /orders', () => {
    it('FIXED: cashier response contains no passwordHash/accessCodeHash anywhere, and createdBy is shaped to {id, fullName, accessName}', async () => {
      const { cashierToken } = await seedAdminCreatedOrder('10.69.10');

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      const order = res.body.find((item: { id: string }) => item.id === res.body[0].id);
      expect(order.createdBy).toBeDefined();
      expect(order.createdBy.fullName).toBe('Admin Test');
      expect(Object.keys(order.createdBy).sort()).toEqual(['accessName', 'fullName', 'id']);
    });

    it('REGRESSION GUARD: assignedWaiter/assignedRider stay select-shaped (already safe pre-fix) — this fix must not weaken them', async () => {
      const { cashierToken } = await seedAdminCreatedOrder('10.69.11');

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      const order = res.body[0];
      // Unassigned in this fixture — the field itself must still be present/null, not throw.
      if (order.assignedWaiter) {
        expect(Object.keys(order.assignedWaiter).sort()).toEqual(['accessName', 'fullName', 'id']);
      }
      if (order.assignedRider) {
        expect(Object.keys(order.assignedRider).sort()).toEqual(['fullName', 'id']);
      }
    });

    it('FIXED: cashier response strips costPrice from every items[].product, subtotal untouched', async () => {
      const { cashierToken } = await seedAdminCreatedOrder('10.69.12');

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      const order = res.body[0];
      expect(Number(order.subtotal)).toBe(9000);
      for (const item of order.items) {
        expect(item.product).not.toHaveProperty('costPrice');
        expect(item.product.name).toBeDefined();
      }
    });

    it('CONTRAST: admin (holds products.update) still receives real costPrice and createdBy is not stripped', async () => {
      const { adminToken } = await seedAdminCreatedOrder('10.69.13');

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      const order = res.body[0];
      expect(Number(order.items[0].product.costPrice)).toBe(2500);
      expect(order.createdBy.fullName).toBe('Admin Test');
    });
  });

  describe('GET /orders/:id', () => {
    it('FIXED: cashier response contains no credential hashes and strips costPrice', async () => {
      const { cashierToken, orderId } = await seedAdminCreatedOrder('10.69.14');

      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      expect(res.body.createdBy.fullName).toBe('Admin Test');
      for (const item of res.body.items) {
        expect(item.product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice on the detail route', async () => {
      const { adminToken, orderId } = await seedAdminCreatedOrder('10.69.15');

      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });
});
