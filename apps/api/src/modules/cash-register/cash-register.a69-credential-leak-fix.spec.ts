import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A69 (blind red-team, round 5 pass 69) — FINDING (CRITICAL, PoC-confirmed):
 * `CashRegisterService.createManualMovement()` used `include: { paymentMethod: true, createdBy: true }`
 * — an unshaped Prisma relation include on `createdBy` — which fetches and serializes the FULL
 * `User` row into the JSON response of `POST /cash-register/movements/manual`, a route gated only
 * by `@Roles('admin', 'cashier', 'supervisor')`. Because the endpoint echoes back the row it just
 * created (`createdById: actorId`), the leaked `passwordHash`/`accessCodeHash`/`sessionVersion`
 * belong to the CALLER's own user — but the identical unshaped-include bug pattern in this same
 * file (`getCloseReadiness()`'s `openedBy: true`, `getOperationalLog()`'s `openedBy`/`closedBy`/
 * `reopenedBy`/`createdBy`/`generatedBy`/`performedBy: true`) was audited too: those sites already
 * reshape the fetched `User` down to `.fullName` before it is ever returned (verified by reading
 * every consumer of those query results — no other credential leak exists in this file). Only
 * `createManualMovement()` returned the raw, unshaped Prisma object directly.
 *
 * The file's OWN established-safe pattern — `getCurrent()`'s and `history()`'s `openedBy`/
 * `closedBy`/`reopenedBy` `select: { id, fullName, email }` — is reused verbatim here.
 *
 * These tests exercise the REAL, unmocked `CashRegisterController` -> `CashRegisterService` chain
 * through the full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A69 — Cash Register module no longer leaks credential hashes via manual movements', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A69 cash-register credential-leak tests require an isolated _test database.');
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

  it('FIXED: POST /cash-register/movements/manual response contains no passwordHash/accessCodeHash, and createdBy is shaped to {id, fullName, email}', async () => {
    await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.30');
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.69.31');

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    const movementRes = await request(app.getHttpServer())
      .post('/cash-register/movements/manual')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        type: 'OTHER_EXPENSE',
        amount: 15000,
        classification: 'Aseo',
        description: 'Compra de insumos de aseo',
      });

    expect(movementRes.status).toBe(201);
    const raw = JSON.stringify(movementRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');

    expect(movementRes.body.createdBy).toBeDefined();
    expect(movementRes.body.createdBy.fullName).toBe('Cashier Test');
    expect(Object.keys(movementRes.body.createdBy).sort()).toEqual(['email', 'fullName', 'id']);
    // Non-credential fields must still be present — this is response shaping, not a broken route.
    expect(Number(movementRes.body.amount)).toBe(15000);
    expect(movementRes.body.classification).toBe('Aseo');
  });

  it('REGRESSION GUARD: GET /cash-register/operational-log (same-file sibling with an identical unshaped-include bug pattern) already only ever surfaced `.fullName`, never a credential hash', async () => {
    await seedTestData(prisma);
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.69.32');

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    const logRes = await request(app.getHttpServer())
      .get('/cash-register/operational-log')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(logRes.status).toBe(200);
    const raw = JSON.stringify(logRes.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('accessCodeHash');
  });
});
