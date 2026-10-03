import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — same unshaped-`include: { createdBy: true }` bug pattern
 * as the auditor's original PoC (Sales/Orders/Purchases/Cash-Register), found and fixed alongside
 * those in the same audit sweep: `ExpensesService.findAll()` fetched and serialized the FULL
 * `User` row — including `passwordHash`/`accessCodeHash`/`sessionVersion` — into the JSON
 * response of `GET /expenses`, a route gated only by `expenses.read` (held by `cashier`).
 *
 * === THE FIX ===
 * `createdBy` is now `select`-shaped to `{ id, fullName, email }` — the same tier used elsewhere
 * in this codebase for staff (email/password) creators.
 *
 * These tests exercise the REAL, unmocked `ExpensesController` -> `ExpensesService` chain through
 * the full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Expenses module no longer leaks credential hashes to non-privileged roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 expenses credential-leak tests require an isolated _test database.');
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

  it('FIXED: cashier GET /expenses response contains no passwordHash/accessCodeHash, and createdBy is shaped to {id, fullName, email}', async () => {
    await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.40');
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.69.41');

    const createRes = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ concept: 'Reparación nevera', amount: 85000 });
    expect(createRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/expenses')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);

    const raw = JSON.stringify(listRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');

    const expense = listRes.body[0];
    expect(expense.createdBy).toBeDefined();
    expect(expense.createdBy.fullName).toBe('Admin Test');
    expect(Object.keys(expense.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
    expect(Number(expense.amount)).toBe(85000);
  });
});
