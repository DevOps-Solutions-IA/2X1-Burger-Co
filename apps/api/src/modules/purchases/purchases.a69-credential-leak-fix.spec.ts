import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — FINDING (CRITICAL, PoC-confirmed):
 * `PurchasesService.findAll()`/`findOne()` used `include: { createdBy: true }` — an unshaped
 * Prisma relation include — which fetches and serializes the FULL `User` row into the JSON
 * response of `GET /purchases`/`GET /purchases/:id`, routes gated only by `purchases.read` (held
 * by the `inventory` role, which does NOT hold `admin`). Since a purchase can be created by
 * `admin` (`POST /purchases` is `@Roles('admin', 'inventory')`), any authenticated `inventory`
 * user could recover the ADMIN account's bcrypt password hash and PIN-access-code hash straight
 * out of the purchase list/detail response — a cross-role credential leak.
 *
 * === THE FIX ===
 * `createdBy` is now `select`-shaped to `{ id, fullName, email }` — the same tier used elsewhere
 * in this codebase for staff (email/password) creators (a purchase is only ever recorded by
 * admin/inventory, never a PIN-login waiter/delivery user).
 *
 * Unlike Sales/Orders, `costPrice` on `items[].product`/`items[].ingredient` is INTENTIONALLY left
 * untouched here — a purchase order inherently deals with cost (that is the entire point of the
 * domain, and `GET /purchases` is only reachable by `admin`/`inventory`, both cost-visible tiers
 * anyway) — this suite asserts that cost stays present as a regression guard against a future,
 * over-broad copy-paste of the Sales/Orders cost-stripping fix into this file.
 *
 * These tests exercise the REAL, unmocked `PurchasesController` -> `PurchasesService` chain
 * through the full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Purchases module no longer leaks credential hashes to non-admin roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 purchases credential-leak tests require an isolated _test database.');
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

  /** Admin creates a purchase (so `createdBy` points at the highest-privilege user — the
   * worst-case leak target for an `inventory`-role reader). */
  async function seedAdminCreatedPurchase(xffPrefix: string) {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', `${xffPrefix}.1`);
    const inventoryToken = await login('inventory@2x1burgerco.local', 'Inventory12345*', `${xffPrefix}.2`);

    const createRes = await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId: seed.supplier.id,
        items: [{ ingredientId: seed.bun.id, quantity: 5, unitCost: 1000 }],
      });
    expect(createRes.status).toBe(201);

    return { seed, adminToken, inventoryToken, purchaseId: createRes.body.id as string };
  }

  describe('GET /purchases', () => {
    it('FIXED: inventory-role response contains no passwordHash/accessCodeHash anywhere, and createdBy is shaped to {id, fullName, email}', async () => {
      const { inventoryToken } = await seedAdminCreatedPurchase('10.69.20');

      const res = await request(app.getHttpServer())
        .get('/purchases')
        .set('Authorization', `Bearer ${inventoryToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      const purchase = res.body[0];
      expect(purchase.createdBy).toBeDefined();
      expect(purchase.createdBy.fullName).toBe('Admin Test');
      expect(Object.keys(purchase.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
    });

    it('REGRESSION GUARD: item cost (unitCost/product costPrice) stays present for inventory — this class of fix must not strip Purchases cost data', async () => {
      const { inventoryToken } = await seedAdminCreatedPurchase('10.69.21');

      const res = await request(app.getHttpServer())
        .get('/purchases')
        .set('Authorization', `Bearer ${inventoryToken}`);

      expect(res.status).toBe(200);
      expect(Number(res.body[0].items[0].unitCost)).toBe(1000);
    });
  });

  describe('GET /purchases/:id', () => {
    it('FIXED: inventory-role response contains no credential hashes', async () => {
      const { inventoryToken, purchaseId } = await seedAdminCreatedPurchase('10.69.22');

      const res = await request(app.getHttpServer())
        .get(`/purchases/${purchaseId}`)
        .set('Authorization', `Bearer ${inventoryToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      expect(res.body.createdBy.fullName).toBe('Admin Test');
    });
  });
});
