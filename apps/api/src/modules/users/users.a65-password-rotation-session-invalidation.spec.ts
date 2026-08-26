import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A65 (blind red team, round 5 pass 65) — FINDING: an admin rotating another user's password
 * via `PATCH /users/:id` (`UsersService.update()`) does NOT invalidate that user's already-issued
 * sessions.
 *
 * ROOT CAUSE
 * ----------
 * `UsersService.update()` (users.service.ts) only called the existing `invalidateUserSessions()`
 * helper (the codebase's established `sessionVersion`-bump primitive — see the A63/A64 fix in
 * `auth.a63-logout-access-token-not-invalidated.spec.ts` and
 * `CashRegisterService.invalidateAllWaiterSessions()`) under this guard:
 *
 *   if (operationalRole && (dto.fullName !== undefined || dto.accessCode !== undefined || dto.accessName !== undefined)) {
 *     await this.invalidateUserSessions(id);
 *   }
 *
 * `operationalRole` is only truthy for users whose ONLY role is `waiter` or `delivery` — and
 * those users authenticate via `accessCode`, never `password` (`resolvePasswordValue()` even
 * synthesizes a random unusable password for them). The actual password-using roles
 * (`admin`, `cashier`, `supervisor`, `inventory`) fall through this guard entirely whenever
 * `dto.password` is rotated, so `invalidateUserSessions()` was NEVER called for a password
 * reset on the roles that actually use passwords.
 *
 * ATTACK SCENARIO
 * ----------------
 * A cashier's credentials are suspected compromised (leaked access/refresh token, shared
 * terminal, etc.). An admin responds by rotating the cashier's password via the Users admin
 * screen (`PATCH /users/:id`), believing this ends the compromised session — this is the entire
 * point of a credential rotation. Before the fix, the cashier's already-issued access token (and
 * refresh token) kept authenticating every protected route until the access token's natural JWT
 * TTL expiry, completely defeating the security response.
 *
 * FIX
 * ---
 * `UsersService.update()` now also calls `invalidateUserSessions(id)` whenever a new
 * `passwordHash` is actually being applied (`passwordHash !== undefined`), independent of the
 * pre-existing operational-role branch above (which serves a different purpose — accessCode/
 * accessName/fullName changes for waiter/delivery — and never overlaps with a password rotation,
 * since operational-role users never get a real `passwordHash` computed).
 *
 * These tests exercise the REAL, unmocked `UsersController` -> `UsersService` chain, and for the
 * end-to-end assertions the REAL `AuthController` -> `AuthService` -> `JwtStrategy` ->
 * `JwtAuthGuard` chain (`createTestApp()`), against real Postgres — mirroring the established
 * convention in `auth.a63-logout-access-token-not-invalidated.spec.ts` for this exact class of
 * finding (sessionVersion-based access-token invalidation).
 */
describe('A65 — PATCH /users/:id password rotation invalidates the target user\'s active sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A65 users password-rotation tests require an isolated _test database.');
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

  async function loginAsAdmin() {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.65.1.1')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  it('FIXED: rotating a cashier\'s password via PATCH /users/:id bumps sessionVersion', async () => {
    const cashierBefore = await prisma.user.findUniqueOrThrow({
      where: { email: 'cashier@2x1burgerco.local' },
    });

    const adminAccessToken = await loginAsAdmin();

    const rotate = await request(app.getHttpServer())
      .patch(`/users/${cashierBefore.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ password: 'RotatedCashier98765*' });
    expect(rotate.status).toBe(200);

    const cashierAfter = await prisma.user.findUniqueOrThrow({
      where: { id: cashierBefore.id },
    });

    expect(cashierAfter.sessionVersion).toBe(cashierBefore.sessionVersion + 1);
    // The new password must actually be applied (rotation must not be a no-op).
    expect(cashierAfter.passwordHash).not.toBe(cashierBefore.passwordHash);
  });

  it('FIXED: end-to-end — the cashier\'s live access token issued BEFORE the rotation is rejected immediately AFTER an admin rotates their password', async () => {
    // Cashier logs in first and holds a live access token, exactly like a real shift session.
    const cashierLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.65.1.2')
      .send({ email: 'cashier@2x1burgerco.local', password: 'Cashier12345*' });
    expect(cashierLogin.status).toBe(201);
    const cashierAccessToken: string = cashierLogin.body.accessToken;

    // Sanity: the token works pre-rotation.
    const preRotation = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${cashierAccessToken}`);
    expect(preRotation.status).toBe(200);
    expect(preRotation.body.email).toBe('cashier@2x1burgerco.local');

    const cashier = await prisma.user.findUniqueOrThrow({
      where: { email: 'cashier@2x1burgerco.local' },
    });

    const adminAccessToken = await loginAsAdmin();

    // Admin responds to a suspected compromise by rotating the cashier's password.
    const rotate = await request(app.getHttpServer())
      .patch(`/users/${cashier.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ password: 'CompromiseResponse12345*' });
    expect(rotate.status).toBe(200);

    // FIXED: the SAME access token that authenticated pre-rotation is immediately rejected —
    // the credential reset actually ends the previously-issued session, closing the window a
    // stolen access/refresh token would otherwise keep exploiting after the "fix".
    const postRotation = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${cashierAccessToken}`);
    expect(postRotation.status).toBe(401);
  });

  it('CONTRAST: updating fullName only (no password change) on an admin/cashier user does NOT bump sessionVersion — this fix is scoped to password rotation, not every profile edit', async () => {
    const cashierBefore = await prisma.user.findUniqueOrThrow({
      where: { email: 'cashier@2x1burgerco.local' },
    });

    const adminAccessToken = await loginAsAdmin();

    const rename = await request(app.getHttpServer())
      .patch(`/users/${cashierBefore.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ fullName: 'Cashier Renamed' });
    expect(rename.status).toBe(200);

    const cashierAfter = await prisma.user.findUniqueOrThrow({
      where: { id: cashierBefore.id },
    });

    expect(cashierAfter.fullName).toBe('Cashier Renamed');
    expect(cashierAfter.sessionVersion).toBe(cashierBefore.sessionVersion);
  });

  it('a waiter\'s (operational-role) accessCode rotation still invalidates sessions via the pre-existing branch (no regression)', async () => {
    const waiterBefore = await prisma.user.findUniqueOrThrow({
      where: { email: 'waiter@2x1burgerco.local' },
    });

    const adminAccessToken = await loginAsAdmin();

    const rotate = await request(app.getHttpServer())
      .patch(`/users/${waiterBefore.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ accessCode: 'NEWCODE9' });
    expect(rotate.status).toBe(200);

    const waiterAfter = await prisma.user.findUniqueOrThrow({
      where: { id: waiterBefore.id },
    });

    expect(waiterAfter.sessionVersion).toBe(waiterBefore.sessionVersion + 1);
  });
});
