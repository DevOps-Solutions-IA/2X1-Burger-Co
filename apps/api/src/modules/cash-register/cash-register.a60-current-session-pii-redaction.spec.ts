import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import {
  resetDatabase,
  seedTestData,
  WAITER_ACCESS_NAME,
  WAITER_ACCESS_CODE,
} from '../../tests/helpers/test-data';

/**
 * A60 — permanent regression test for the A59 (blind red team, round 5 pass 59) finding (HIGH):
 * `GET /cash-register/current` used to return the FULL `CashSession` row — including the entire
 * `movements` array (every `CashMovement`: amount, `classification`, `description`,
 * `paymentMethod`, and the creator's `id`/`fullName`/`email`) and `openedBy`
 * (`id`/`fullName`/`email`) — to the `waiter` role, with zero scoping/redaction based on caller
 * privilege.
 *
 * ORIGINAL ROOT CAUSE
 * --------------------
 * `CashRegisterController.getCurrent()` is gated `@Roles('cash.read', 'waiter')` — a deliberate,
 * tested design decision (see `apps/api/src/modules/auth/rbac-auth.spec.ts`: "Waiter puede
 * consultar GET /cash-register/current para validar caja abierta (200)") so the waiter-facing POS
 * screen (`apps/web/src/app/(waiter)/waiter/page.client.tsx`) can show an "Abrir caja" banner
 * before letting a waiter save an order. The waiter frontend only ever reads the response for
 * TRUTHINESS / `.id` (its local `CurrentCashSession` type is `{ id: string }` — it never reads
 * `.movements`, `.openedBy`, or any amount field). But `CashRegisterService.getCurrent()` did not
 * scope its response to caller role at all — it unconditionally returned the FULL Prisma include.
 *
 * FIX (A60)
 * ---------
 * `CashRegisterController.getCurrent()` now threads the acting actor into
 * `CashRegisterService.getCurrent(actor)` via `@CurrentUser()`. The service branches the RETURNED
 * SHAPE on `isPrivilegedCashOperator(actor)` (holds the `cash.read` permission, or has the
 * `admin`/`cashier`/`supervisor` role — the same admin/cashier/supervisor convention used by
 * `isPrivilegedOrderOperator`/`isPrivilegedTableOperator` elsewhere in this codebase):
 *   - Privileged actor (cash.read, or admin/cashier/supervisor): receives the EXACT full response
 *     shape as before (movements ledger + staff PII) — no regression for legitimate consumers.
 *   - Non-privileged actor (waiter, or anyone else reaching this route without cash authority):
 *     receives only `{ id: string, isOpen: boolean }` when a session is open, or `null` when none
 *     is open — enough to answer "is the register open", nothing else.
 *
 * This test proves the fix against the REAL, unmocked `CashRegisterService` + real Postgres + real
 * role-based login, through the full Nest DI graph (`createTestApp()`), not a hand-wired stub.
 */
describe('A60 — GET /cash-register/current redacts the CashMovement ledger + staff PII for non-privileged actors', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A60 tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function adminLogin() {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.9.1.1')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function waiterLogin() {
    const response = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', '10.9.1.2')
      .send({ name: WAITER_ACCESS_NAME, accessCode: WAITER_ACCESS_CODE });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  it('FIXED: a waiter reading /cash-register/current receives ONLY a minimal { id, isOpen } shape — no movements, no PII', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await adminLogin();

    // Admin opens the register (creates an OPENING CashMovement with a distinguishing amount) and
    // records a manual adjustment — the kind of privileged, sensitive financial action (e.g. a
    // cash-drawer correction) whose amount/reason/creator identity a waiter has no business seeing.
    const openResponse = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 250000, notes: 'Apertura A60' });
    expect(openResponse.status).toBe(201);
    const openedSessionId = openResponse.body.id as string;

    const manualMovementAmount = 987654;
    const manualMovementResponse = await request(app.getHttpServer())
      .post('/cash-register/movements/manual')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'OTHER_EXPENSE',
        amount: manualMovementAmount,
        classification: 'Ajuste confidencial A60',
        paymentMethodId: seed.paymentCash.id,
        description: 'Retiro sensible de caja - solo administración debería ver esto',
      });
    expect(manualMovementResponse.status).toBe(201);

    // Sibling routes over the SAME CashSession/CashMovement resource: correctly reject the waiter,
    // proving the module's own intended sensitivity classification for this exact data.
    const waiterToken = await waiterLogin();
    const historyAsWaiter = await request(app.getHttpServer())
      .get('/cash-register/history')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(historyAsWaiter.status).toBe(403);

    const operationalLogAsWaiter = await request(app.getHttpServer())
      .get('/cash-register/operational-log')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(operationalLogAsWaiter.status).toBe(403);

    // FIXED CALL: the sibling `/current` route, reached with the identical waiter token, over the
    // identical underlying resource — must now be redacted.
    const currentAsWaiter = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(currentAsWaiter.status).toBe(200);

    const session = currentAsWaiter.body;
    expect(session).toBeTruthy();

    // The waiter still gets what its legitimate use case needs: "is the register open".
    expect(session.id).toBe(openedSessionId);
    expect(session.isOpen).toBe(true);

    // No financial-ledger data and no staff PII may leak through this shape.
    expect(session.movements).toBeUndefined();
    expect(session.openedBy).toBeUndefined();
    expect(session.reopenedFromSession).toBeUndefined();
    expect(session.openingAmount).toBeUndefined();
    expect(session.notes).toBeUndefined();

    // Defense-in-depth: no key anywhere in the payload carries PII field names or the planted
    // secret values from the admin's manual movement.
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain('admin@2x1burgerco.local');
    expect(serialized).not.toContain('Admin Test');
    expect(serialized).not.toContain('Ajuste confidencial A60');
    expect(serialized).not.toContain(String(manualMovementAmount));
    expect(Object.keys(session).sort()).toEqual(['id', 'isOpen']);
  });

  it('CONTROL: cashier (who DOES hold cash.read) still sees the identical full payload via /current — proving privileged consumers are unaffected by the redaction', async () => {
    await seedTestData(prisma);
    const adminToken = await adminLogin();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });

    const cashierLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.9.1.3')
      .send({ email: 'cashier@2x1burgerco.local', password: 'Cashier12345*' });
    expect(cashierLoginResponse.status).toBe(201);
    const cashierToken = cashierLoginResponse.body.accessToken as string;

    const currentAsCashier = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(currentAsCashier.status).toBe(200);
    expect(Array.isArray(currentAsCashier.body.movements)).toBe(true);
    expect(currentAsCashier.body.openedBy?.email).toBe('admin@2x1burgerco.local');
    expect(currentAsCashier.body.openedBy?.fullName).toBe('Admin Test');
  });

  it('CONTROL: admin (who DOES hold cash.read) still sees the identical full payload via /current', async () => {
    await seedTestData(prisma);
    const adminToken = await adminLogin();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 150000 });

    const currentAsAdmin = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(currentAsAdmin.status).toBe(200);
    expect(Array.isArray(currentAsAdmin.body.movements)).toBe(true);
    expect(currentAsAdmin.body.openedBy?.email).toBe('admin@2x1burgerco.local');
  });

  it('CONTROL: delivery role (no cash-register access at all) is correctly rejected 403 on /current, unaffected by the redaction fix', async () => {
    await seedTestData(prisma);

    const deliveryLoginResponse = await request(app.getHttpServer())
      .post('/auth/delivery-login')
      .set('X-Forwarded-For', '10.9.1.4')
      .send({ name: 'Domiciliario Principal', accessCode: 'D124578' });
    expect(deliveryLoginResponse.status).toBe(201);
    const deliveryToken = deliveryLoginResponse.body.accessToken as string;

    const currentAsDelivery = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${deliveryToken}`);

    expect(currentAsDelivery.status).toBe(403);
  });

  it('a waiter reading /cash-register/current when no session is open still receives null (unchanged behavior)', async () => {
    await seedTestData(prisma);
    const waiterToken = await waiterLogin();

    const currentAsWaiter = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(currentAsWaiter.status).toBe(200);
    expect(currentAsWaiter.body).toBeNull();
  });
});
