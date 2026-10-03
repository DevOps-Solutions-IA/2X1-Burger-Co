import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — a SECOND, previously-unflagged instance of the exact
 * same unshaped-`include: { createdBy: true }` bug pattern that this round's auditor PoC'd for
 * Sales/Orders/Purchases/Cash-Register, found while sweeping the rest of
 * `apps/api/src/modules/` for the same construct: `ReportsService.listSupplierNotifications()`
 * fetched and serialized the FULL `User` row — including `passwordHash`/`accessCodeHash`/
 * `sessionVersion` — into the JSON response of `GET /reports/supplier-notifications`, a route
 * gated by `@Roles('admin', 'inventory', 'supervisor')` AND `@Permissions('reports.read')`. This
 * is a real, HTTP-reachable leak of the same severity class: an `inventory`/`supervisor` reader
 * (neither holds `admin`) could recover another user's (including an admin's) credential hashes.
 *
 * === THE FIX ===
 * `createdBy` is now `select`-shaped to `{ id, fullName, email }` — the same tier this file
 * already uses for `generatedBy` in `getDailyClosures()`/`getDailyClosure()` (A67).
 *
 * NOTE ON TEST COVERAGE: the seeded test fixtures (`apps/api/src/tests/helpers/test-data.ts`) do
 * not include a `supervisor` user, and the `inventory` role fixture does not hold `reports.read`
 * — so this suite cannot reproduce the exact cross-role scenario (a non-admin reader seeing an
 * admin's hash) end-to-end the way the sibling A69 suites for Sales/Orders/Purchases/Cash-Register
 * do. It still exercises the REAL, unmocked route with the admin fixture (the only seeded user
 * that satisfies both the role and permission gate) and asserts the structural shape of the fix —
 * a regression guard against the unshaped `include: { createdBy: true }` pattern resurfacing here.
 */
describe('A69 — Reports module (supplier notifications) no longer leaks credential hashes', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 reports supplier-notification credential-leak tests require an isolated _test database.');
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

  it('FIXED: GET /reports/supplier-notifications response contains no passwordHash/accessCodeHash, and createdBy is shaped to {id, fullName, email}', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.60');

    // createSupplierNotification() only accepts a supplierId that appears in the current supply
    // alerts (an ingredient below stockMin whose LATEST purchase came from that supplier) — record
    // a purchase from the seeded supplier, then force the ingredient below stockMin.
    const purchaseRes = await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId: seed.supplier.id,
        items: [{ ingredientId: seed.bun.id, quantity: 5, unitCost: 1000 }],
      });
    expect(purchaseRes.status).toBe(201);
    await prisma.ingredient.update({ where: { id: seed.bun.id }, data: { currentStock: 0 } });

    const createRes = await request(app.getHttpServer())
      .post('/reports/supplier-notifications/manual')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: seed.supplier.id });
    expect(createRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/reports/supplier-notifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);

    const raw = JSON.stringify(listRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');

    const notification = listRes.body[0];
    expect(notification.createdBy).toBeDefined();
    expect(notification.createdBy.fullName).toBe('Admin Test');
    expect(Object.keys(notification.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
  });
});
