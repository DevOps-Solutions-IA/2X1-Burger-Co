import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — same unshaped-`include: { createdBy: true }` /
 * `{ approvedBy: true }` bug pattern as the auditor's original PoC, found and fixed alongside it
 * in the same audit sweep: `InventoryService.createStockCount()` and `findStockCounts()` both
 * fetched and serialized the FULL `User` row — including `passwordHash`/`accessCodeHash`/
 * `sessionVersion` — for both `createdBy` AND `approvedBy` into the JSON responses of
 * `POST /inventory/stock-counts` and `GET /inventory/stock-counts`, routes gated only by
 * `@Roles('admin', 'inventory')`. Because a stock count is auto-approved by the same actor who
 * created it (`approvedById: actorId` set unconditionally in `createStockCount()`), an admin's
 * hash could leak to an `inventory`-role reader through either field.
 *
 * === THE FIX ===
 * Both `createdBy` and `approvedBy` are now `select`-shaped to `{ id, fullName, email }` — the
 * same tier this file already uses for `performedBy` in `findMovements()`.
 *
 * These tests exercise the REAL, unmocked `InventoryController` -> `InventoryService` chain
 * through the full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Inventory module no longer leaks credential hashes via stock counts', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 inventory credential-leak tests require an isolated _test database.');
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

  it('FIXED: POST /inventory/stock-counts response contains no passwordHash/accessCodeHash — createdBy and approvedBy are both shaped to {id, fullName, email}', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.50');

    const createRes = await request(app.getHttpServer())
      .post('/inventory/stock-counts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scope: 'PRODUCTS',
        items: [{ itemType: 'PRODUCT', itemId: seed.soda.id, countedStock: 8 }],
      });

    expect(createRes.status).toBe(201);
    const raw = JSON.stringify(createRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');

    expect(createRes.body.createdBy.fullName).toBe('Admin Test');
    expect(Object.keys(createRes.body.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
    expect(createRes.body.approvedBy.fullName).toBe('Admin Test');
    expect(Object.keys(createRes.body.approvedBy).sort()).toEqual(['email', 'fullName', 'id']);
  });

  it('FIXED: GET /inventory/stock-counts response (read by inventory-role, not admin) contains no credential hashes', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.51');
    const inventoryToken = await login('inventory@2x1burgerco.local', 'Inventory12345*', '10.69.52');

    const createRes = await request(app.getHttpServer())
      .post('/inventory/stock-counts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scope: 'PRODUCTS',
        items: [{ itemType: 'PRODUCT', itemId: seed.soda.id, countedStock: 7 }],
      });
    expect(createRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/inventory/stock-counts')
      .set('Authorization', `Bearer ${inventoryToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    const raw = JSON.stringify(listRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');
    expect(listRes.body[0].createdBy.fullName).toBe('Admin Test');
  });
});
