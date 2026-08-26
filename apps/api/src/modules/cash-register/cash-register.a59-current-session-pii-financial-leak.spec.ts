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
 * A59 (blind red team, round 5 pass 59) — FINDING (HIGH): `GET /cash-register/current` returns the
 * FULL `CashSession` row — including the entire `movements` array (every `CashMovement`: amount,
 * `classification`, `description`, `paymentMethod`, and the creator's `id`/`fullName`/`email`) and
 * `openedBy` (`id`/`fullName`/`email`) — to the `waiter` role, with zero scoping/redaction based on
 * caller privilege.
 *
 * ROOT CAUSE
 * ----------
 * `CashRegisterController.getCurrent()` (`apps/api/src/modules/cash-register/cash-register.controller.ts`
 * line 18-23) is gated `@Roles('cash.read', 'waiter')` — a deliberate, tested design decision (see
 * `apps/api/src/modules/auth/rbac-auth.spec.ts`: "Waiter puede consultar GET /cash-register/current
 * para validar caja abierta (200)") so the waiter-facing POS screen
 * (`apps/web/src/app/(waiter)/waiter/page.client.tsx`) can show an "Abrir caja" banner before letting
 * a waiter save an order. The waiter frontend only ever reads `currentCash.data` for TRUTHINESS
 * (`!currentCash.data`, `currentCash.data ? 'Abierta' : 'Cerrada'` — see lines 861-1694 of that file)
 * — it never reads `.movements`, `.openedBy`, or any amount field.
 *
 * However, `CashRegisterService.getCurrent()` (`cash-register.service.ts` lines 31-61) does NOT scope
 * its response to caller role at all — it unconditionally returns the FULL Prisma include: every
 * `CashMovement` in the open session (`type`, `amount`, `classification`, `description`,
 * `paymentMethod`, and `createdBy: {id, fullName, email}` — the actor who created each movement,
 * which can be an admin/cashier/supervisor recording payments, manual adjustments, or discounts) plus
 * `openedBy: {id, fullName, email}`. `prisma/seed.ts` explicitly does NOT grant the `waiter` role
 * `cash.read` (waiter's permission list is `auth.*`, `tables.read`, `orders.read`, `orders.create`,
 * `orders.update`, `products.read` only) — every OTHER route touching the identical
 * `CashSession`/`CashMovement` resource (`GET /cash-register/history`, `GET
 * /cash-register/operational-log`, `GET /cash-register/daily-summary`, `GET
 * /cash-register/close-checklist`, `POST /cash-register/movements/manual`) correctly requires
 * `admin`/`cashier`/`supervisor`. `getCurrent()` is the ONE sibling route that bypasses that
 * boundary — not by omission of a role check (the route IS explicitly gated), but by returning
 * strictly more data than the gate's own stated purpose ("validar caja abierta") requires, with no
 * role-conditional projection at the service layer.
 *
 * IMPACT
 * ------
 * A `waiter` account — CLAUDE.md-recognized as a POS-facing, comparatively low-trust role with no
 * cash-module authority at all — can read, for the entire currently open cash-register session:
 *   - every cash movement's exact amount, classification and description (manual income/expense
 *     adjustments, opening amount, etc.), and
 *   - the full name AND email of whichever admin/cashier/supervisor created each movement or opened
 *     the session (CLAUDE.md section 17/23 PII).
 * This is read-only (no fund manipulation), but it is a direct violation of the mission's explicit
 * "no PII exposure via a missing mask/scope" invariant and of the "every route touching a shared
 * resource must apply the SAME authorization scope" pattern: a boolean "is the register open"
 * signal is turned into a full financial-ledger + staff-PII leak by the absence of a projection
 * appropriate to the `waiter` role, which is inconsistent with every other route over the identical
 * `CashSession`/`CashMovement` resource.
 *
 * This test proves it against the REAL, unmocked `CashRegisterService` + real Postgres + real
 * role-based login, through the full Nest DI graph (`createTestApp()`), not a hand-wired stub.
 */
describe('A59 — GET /cash-register/current leaks full CashMovement ledger + staff PII to the waiter role', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A59 tests require an isolated _test database.');
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

  it('FINDING: a waiter reading /cash-register/current (to check "is the register open") receives every CashMovement amount plus the admin creator\'s full name and email', async () => {
    const seed = await seedTestData(prisma);
    const adminToken = await adminLogin();

    // Admin opens the register (this itself creates an OPENING CashMovement with a distinguishing
    // amount) and then records a manual adjustment — the kind of privileged, sensitive financial
    // action (e.g. a cash-drawer correction) whose amount/reason/creator identity a waiter has no
    // business seeing.
    const openResponse = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 250000, notes: 'Apertura A59' });
    expect(openResponse.status).toBe(201);

    const manualMovementAmount = 987654;
    const manualMovementResponse = await request(app.getHttpServer())
      .post('/cash-register/movements/manual')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'OTHER_EXPENSE',
        amount: manualMovementAmount,
        classification: 'Ajuste confidencial A59',
        paymentMethodId: seed.paymentCash.id,
        description: 'Retiro sensible de caja - solo administración debería ver esto',
      });
    expect(manualMovementResponse.status).toBe(201);

    // Sibling route over the SAME CashSession/CashMovement resource: correctly rejects the waiter,
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

    // VULNERABLE CALL: the sibling `/current` route, reached with the identical waiter token, over
    // the identical underlying resource.
    const currentAsWaiter = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(currentAsWaiter.status).toBe(200);

    const session = currentAsWaiter.body;
    expect(session).toBeTruthy();

    // Full staff PII of whoever opened the register is exposed to the waiter.
    expect(session.openedBy).toBeTruthy();
    expect(session.openedBy.email).toBe('admin@2x1burgerco.local');
    expect(session.openedBy.fullName).toBe('Admin Test');

    // The complete, unredacted movements ledger (amounts, classification, description, payment
    // method, and the creator's PII) is exposed to the waiter — including the manual adjustment an
    // admin just recorded, which the sibling `/history` and `/operational-log` routes on the SAME
    // resource correctly keep behind an admin/cashier/supervisor gate.
    expect(Array.isArray(session.movements)).toBe(true);
    const manualMovement = session.movements.find(
      (movement: { classification?: string }) => movement.classification === 'Ajuste confidencial A59',
    );
    expect(manualMovement).toBeTruthy();
    expect(Number(manualMovement.amount)).toBe(manualMovementAmount);
    expect(manualMovement.description).toBe('Retiro sensible de caja - solo administración debería ver esto');
    expect(manualMovement.createdBy).toBeTruthy();
    expect(manualMovement.createdBy.email).toBe('admin@2x1burgerco.local');
    expect(manualMovement.createdBy.fullName).toBe('Admin Test');
    expect(manualMovement.paymentMethod).toBeTruthy();
    expect(manualMovement.paymentMethod.id).toBe(seed.paymentCash.id);

    const openingMovement = session.movements.find(
      (movement: { type?: string }) => movement.type === 'OPENING',
    );
    expect(openingMovement).toBeTruthy();
    expect(Number(openingMovement.amount)).toBe(250000);
  });

  it('CONTROL: cashier (who DOES hold cash.read) sees the identical full payload via /current — proving the leak is specifically about the waiter bypass, not a general design choice to hide movements from everyone', async () => {
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
  });

  it('CONTROL: delivery role (no cash-register access at all) is correctly rejected 403 on /current, contrasting with the waiter bypass above', async () => {
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
});
