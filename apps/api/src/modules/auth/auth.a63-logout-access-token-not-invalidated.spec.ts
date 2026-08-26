import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A63 (blind red team, round 5 pass 63) — FINDING: `POST /auth/logout` does not invalidate the
 * caller's already-issued access token; it remains fully usable on every protected route until
 * its natural JWT expiry (`JWT_ACCESS_EXPIRES_IN`, default `15m`), regardless of the logout call.
 *
 * ROOT CAUSE
 * ----------
 * `AuthService.logout()` (auth.service.ts) only marks the presented (or all of the user's)
 * `RefreshToken` rows as `revokedAt = now()`. It never touches `User.sessionVersion`.
 *
 * `JwtStrategy.validate()` (jwt.strategy.ts) is the ONLY gate that can reject an otherwise
 * well-signed, non-expired access token before its TTL elapses, and it does so purely by
 * comparing `payload.sessionVersion` (baked into the access token at issuance) against the
 * CURRENT `User.sessionVersion` row in Postgres:
 *
 *   if (!user || !user.isActive || user.sessionVersion !== payload.sessionVersion) throw 401;
 *
 * This exact `sessionVersion` bump-to-invalidate mechanism is already used, correctly, by other
 * flows in this same codebase for immediate, non-TTL-bounded access-token revocation:
 *   - `AuthService.revokeTokenFamily()` — invoked from `rotateRefreshToken()` when a REVOKED
 *     refresh token is presented again (reuse detection, H-06). NOTE: this is a coincidental,
 *     narrow safety net, not a substitute for logout invalidation — it only fires if the caller
 *     later attempts `/auth/refresh` with the dead token. A holder of ONLY the access token
 *     (e.g. leaked via XSS, shared-terminal DevTools/history, since the access token is sent as
 *     a bearer header, not an httpOnly cookie like the refresh token) never touches the refresh
 *     token at all, so this net is never triggered for them (see the third test below).
 *   - `CashRegisterService.invalidateAllWaiterSessions()` — force-logs-out every waiter/delivery
 *     user the instant a cash session is closed (cash-register.service.ts).
 *
 * `logout()` is the one place in the auth lifecycle that is supposed to end a session on the
 * user's own explicit request, yet it is the one place that OMITS the `sessionVersion` bump,
 * making an explicit logout strictly weaker than the automated/security-driven invalidation
 * paths that already exist beside it for the identical resource.
 *
 * ATTACK SCENARIO
 * ----------------
 * A cashier logs in on a shared/POS terminal, and at shift end clicks "logout". Logout returns
 * `{ success: true }`, so the operator believes the session is fully closed. But the access token
 * issued during that session keeps authenticating — fetching PII (`GET /auth/me`) and any other
 * `JwtAuthGuard`-protected route the user's role permits — for up to `JWT_ACCESS_EXPIRES_IN` (15
 * minutes by default) AFTER logout, as long as nobody separately triggers refresh-reuse detection
 * by attempting `/auth/refresh` with the dead refresh token. Fail-closed is violated: an actor who
 * no longer has a valid session, per the user's own intent and per the API's own success response,
 * can still authenticate and act as that user for the remainder of the access-token TTL.
 *
 * These tests exercise the REAL, unmocked `AuthController` -> `AuthService` -> `JwtStrategy` ->
 * `JwtAuthGuard` chain through the full Nest DI graph (`createTestApp()`) against real Postgres,
 * exactly mirroring how a browser client calls `/auth/login`, `/auth/logout`, then reuses the
 * access token it already holds in memory (or an attacker reuses a leaked one).
 *
 * SOFIA Round 5 / A64 CLOSURE — this finding is FIXED. `AuthService.logout()` now bumps
 * `User.sessionVersion` in both its call branches (single-device: presented refresh token
 * revoked + sessionVersion bumped in the same transaction; all-devices: routed through the
 * existing `revokeTokenFamily()`, which already bumped it). This file is kept as a PERMANENT
 * regression test of the fixed behavior — the original finding narrative above is retained as
 * historical documentation of the exact mechanism that must never regress.
 */
describe('A63/A64 — POST /auth/logout immediately invalidates the caller\'s live access token (sessionVersion bumped)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A63 logout tests require an isolated _test database.');
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

  function extractRefreshCookie(setCookieHeader: string[] | string | undefined) {
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('refresh_token='));
    if (!refreshCookie) throw new Error('No refresh_token cookie returned by /auth/login.');
    return (refreshCookie.split(';')[0] as string | undefined) ?? refreshCookie;
  }

  it('FIXED: a logged-out access token no longer authenticates GET /auth/me — sessionVersion is bumped by logout()', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.63.1.1')
      .send({ email: 'cashier@2x1burgerco.local', password: 'Cashier12345*' });
    expect(login.status).toBe(201);

    const accessToken: string = login.body.accessToken;
    const refreshCookie = extractRefreshCookie(login.headers['set-cookie']);
    expect(typeof accessToken).toBe('string');

    // Sanity: the token works pre-logout.
    const preLogout = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(preLogout.status).toBe(200);
    expect(preLogout.body.email).toBe('cashier@2x1burgerco.local');

    const cashierBefore = await prisma.user.findUniqueOrThrow({
      where: { email: 'cashier@2x1burgerco.local' },
    });

    // Log out exactly like the real frontend does: bearer access token + refresh cookie.
    // Deliberately do NOT touch /auth/refresh anywhere in this test — a real logged-out client,
    // and a real attacker who only ever obtained the access token, never presents the (now dead)
    // refresh token again, so the narrow reuse-detection net in rotateRefreshToken() never fires.
    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);
    expect(logout.status).toBe(201);
    expect(logout.body).toEqual({ success: true });

    // FIXED (A64): sessionVersion IS bumped by logout() alone — no refresh-replay needed.
    const cashierAfter = await prisma.user.findUniqueOrThrow({
      where: { email: 'cashier@2x1burgerco.local' },
    });
    expect(cashierAfter.sessionVersion).toBe(cashierBefore.sessionVersion + 1);

    // FIXED: the SAME access token that authenticated pre-logout is immediately rejected
    // post-logout — it can no longer be used to act as the user or read PII (email/fullName/
    // roles/permissions) via `/auth/me` or any other JwtAuthGuard route.
    const postLogout = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(postLogout.status).toBe(401);
  });

  it('FIXED: logout() alone kills the access token without ever touching /auth/refresh — no reliance on the unrelated reuse-detection safety net', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.63.1.2')
      .send({ email: 'cashier@2x1burgerco.local', password: 'Cashier12345*' });
    const accessToken: string = login.body.accessToken;
    const refreshCookie = extractRefreshCookie(login.headers['set-cookie']);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);

    // FIXED: the access token is already dead immediately after logout — deliberately without
    // ever calling /auth/refresh in this test, proving the fix does not depend on the separate,
    // narrower reuse-detection safety net (H-06) that only fires if the dead refresh token is
    // later replayed. A holder of only the access token (XSS, shared-terminal history) never
    // touches the refresh token at all, so that net is irrelevant to this fix's correctness.
    const deadImmediately = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(deadImmediately.status).toBe(401);
  });

  it('CONTRAST: the codebase already has a working immediate-invalidation mechanism (sessionVersion bump) — cash-session force-logout uses it, logout() does not', async () => {
    const waiterLogin = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', '10.63.2.1')
      .send({ name: 'Mesero Principal', accessCode: 'M124578' });
    expect(waiterLogin.status).toBe(201);
    const waiterAccessToken: string = waiterLogin.body.accessToken;

    const preClose = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${waiterAccessToken}`);
    expect(preClose.status).toBe(200);

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.63.2.2')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(adminLogin.status).toBe(201);
    const adminAccessToken: string = adminLogin.body.accessToken;

    const openSession = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ openingAmount: 100000 });
    expect(openSession.status).toBe(201);

    const closeSession = await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ actualAmount: 100000 });
    expect(closeSession.status).toBe(201);

    // Closing the cash session force-logs-out every waiter/delivery user via a sessionVersion
    // bump (CashRegisterService.invalidateAllWaiterSessions) — the SAME mechanism `logout()`
    // could use for itself but does not. This proves the mechanism exists, works, and is simply
    // not wired into the user-initiated logout path.
    const postClose = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${waiterAccessToken}`);
    expect(postClose.status).toBe(401);
  });
});
