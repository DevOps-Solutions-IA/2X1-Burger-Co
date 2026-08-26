import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A65 (blind red team, round 5 pass 65) — FINDING (LOW): the `CashMovement` ledger entry linked
 * to an `Expense` is never updated when the expense is edited while its cash session is still
 * open.
 *
 * ROOT CAUSE
 * ----------
 * `ExpensesService.create()` (expenses.service.ts) creates a linked `CashMovement` row
 * (`referenceType: 'expense'`, `referenceId: expense.id`, scoped to the currently-open
 * `CashSession`) alongside the `Expense`. `ExpensesService.update()` correctly records the
 * old/new `amount` in `AuditLog`, but never touched the linked `CashMovement.amount` — so after
 * editing an expense's amount, the `CashMovement` row (used by the movements list / forensic
 * cash-session log) kept showing the STALE pre-edit amount even though the `Expense` itself and
 * the audit trail were both correct.
 *
 * NOTE: this is NOT a cash-reconciliation exploit. `CashRegisterService.close()` ->
 * `CashReconciliationService.buildForSession()` re-reads `Expense.amount` LIVE from the
 * `expenses` table (not from `CashMovement`), so the actual cash-closing math was already
 * correct before this fix. This closes a ledger-detail / forensic-trail inconsistency: the
 * `CashMovement` row itself must reflect the true current expense amount for anyone auditing the
 * movements log mid-session (before close()).
 *
 * FIX
 * ---
 * `ExpensesService.update()` now runs inside a `$transaction` and, when `dto.amount` changes AND
 * the expense is linked to a still-open `CashSession` (`existing.cashSessionId` — `update()`
 * already fail-closed rejects edits once the session is `CLOSED`, so if we get this far the
 * linked session, if any, is open), updates the matching `CashMovement` row
 * (`referenceType: 'expense'`, `referenceId`, scoped to `cashSessionId`) to the new amount —
 * consistent with how `create()` establishes that same link.
 *
 * These tests exercise the REAL, unmocked `ExpensesController` -> `ExpensesService` chain
 * (and the real `CashRegisterController` to open the session) through the full Nest DI graph
 * (`createTestApp()`) against real Postgres.
 */
describe('A65 — editing an expense amount while its cash session is open keeps the linked CashMovement.amount in sync', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A65 expenses cash-movement-sync tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  async function loginAdmin(xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  it('FIXED: PATCH /expenses/:id with a new amount updates the linked open-session CashMovement.amount to match', async () => {
    const adminAccessToken = await loginAdmin('10.65.3.1');

    const openSession = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ openingAmount: 100000 });
    expect(openSession.status).toBe(201);

    const createExpense = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ concept: 'Compra de hielo', amount: 15000 });
    expect(createExpense.status).toBe(201);
    const expenseId: string = createExpense.body.id;

    const movementBefore = await prisma.cashMovement.findFirstOrThrow({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(Number(movementBefore.amount)).toBe(15000);

    const updateExpense = await request(app.getHttpServer())
      .patch(`/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 27500 });
    expect(updateExpense.status).toBe(200);
    expect(Number(updateExpense.body.amount)).toBe(27500);

    // FIXED: the linked CashMovement ledger row is updated in the same operation — it no longer
    // shows the stale pre-edit amount.
    const movementAfter = await prisma.cashMovement.findFirstOrThrow({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(Number(movementAfter.amount)).toBe(27500);
    // Sanity: still exactly one linked movement row (no duplicate created by the fix).
    const movementCount = await prisma.cashMovement.count({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(movementCount).toBe(1);
  });

  it('editing an expense field OTHER than amount does not touch the linked CashMovement.amount', async () => {
    const adminAccessToken = await loginAdmin('10.65.3.2');

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ openingAmount: 100000 });

    const createExpense = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ concept: 'Compra de servilletas', amount: 8000 });
    expect(createExpense.status).toBe(201);
    const expenseId: string = createExpense.body.id;

    const updateExpense = await request(app.getHttpServer())
      .patch(`/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ description: 'Servilletas para el mes' });
    expect(updateExpense.status).toBe(200);

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(Number(movement.amount)).toBe(8000);
  });

  it('an expense created with NO open cash session has no linked CashMovement, and editing its amount does not throw', async () => {
    const adminAccessToken = await loginAdmin('10.65.3.3');

    // Deliberately do NOT open a cash session first.
    const createExpense = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ concept: 'Gasto sin caja abierta', amount: 5000 });
    expect(createExpense.status).toBe(201);
    const expenseId: string = createExpense.body.id;

    const movementCount = await prisma.cashMovement.count({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(movementCount).toBe(0);

    const updateExpense = await request(app.getHttpServer())
      .patch(`/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 6000 });
    expect(updateExpense.status).toBe(200);
    expect(Number(updateExpense.body.amount)).toBe(6000);

    // Still no CashMovement to create/update — nothing to sync.
    const movementCountAfter = await prisma.cashMovement.count({
      where: { referenceType: 'expense', referenceId: expenseId },
    });
    expect(movementCountAfter).toBe(0);
  });
});
