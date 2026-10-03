import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A71 (blind red-team, round 5 pass 71) — FINDING (HIGH): `UsersService.create()`, `update()`,
 * and `updateStatus()` returned the raw Prisma `User` row (with `roles` included) straight from
 * `prisma.user.create()`/`tx.user.update()`/`prisma.user.update()` — including `passwordHash`
 * (bcrypt) and `accessCodeHash` (bcrypt of the operational-role PIN, min 6 chars per the DTOs) —
 * with no `select`/shaping applied. `UsersController` (`POST /users`, `PATCH /users/:id`,
 * `PATCH /users/:id/status`) returned each service result unchanged to the HTTP client, so an
 * admin creating or editing ANY user (including themselves, or another admin) received that
 * user's bcrypt password hash and PIN-access-code hash straight in the HTTP response body.
 *
 * `findAll()` (`GET /users`) already applied the correct safe shape
 * (`{ id, email, fullName, accessName, hasAccessCode, isActive, lastLoginAt, createdAt, roles }`)
 * — proving the intended design always excluded the raw hashes — but `create()`/`update()`/
 * `updateStatus()` never reused that shaping for their own HTTP return value. The `auditService.log()`
 * calls inside `create()`/`update()` were already correct (`hasAccessCode: Boolean(...)`, never the
 * raw hash) — this finding is scoped purely to the HTTP response shape, and audit logging behavior
 * is untouched by the fix.
 *
 * === THE FIX ===
 * `UsersService` now has a single private `toSafeUserDto()` helper (the exact shape `findAll()`
 * already used) reused by `findAll()`, `create()`, `update()`, and `updateStatus()` — so the safe
 * shape can never drift between these four methods again. `updateStatus()`'s Prisma query now also
 * `include`s `roles` (it previously didn't fetch them at all) so the shared helper has what it
 * needs.
 *
 * These tests exercise the REAL, unmocked `UsersController` -> `UsersService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres, mirroring the established
 * `*.a69-credential-leak-fix.spec.ts` blunt-substring-check convention from the immediately
 * preceding round, plus positive assertions on the fields the frontend (`apps/web/.../users/page.tsx`)
 * actually reads off these responses (`id`, `roles[].name`, `isActive`, `hasAccessCode`,
 * `lastLoginAt`) — the frontend only invalidates and refetches `GET /users` after a mutation, so it
 * does not depend on any extra field beyond that shared safe shape.
 */
describe('A71 — Users module create()/update()/updateStatus() no longer leak passwordHash/accessCodeHash', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A71 users credential-leak tests require an isolated _test database.');
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

  async function loginAsAdmin(xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  async function getCashierRoleId() {
    const cashierRole = await prisma.role.findFirstOrThrow({ where: { name: 'cashier' } });
    return cashierRole.id;
  }

  describe('POST /users', () => {
    it('FIXED: response contains no passwordHash/accessCodeHash anywhere, and DOES contain the fields the frontend needs', async () => {
      const adminToken = await loginAsAdmin('10.71.1');
      const roleId = await getCashierRoleId();

      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'new.cashier.a71@2x1burgerco.local',
          fullName: 'Nuevo Cajero A71',
          password: 'NewCashier98765*',
          roleIds: [roleId],
        });
      expect(res.status).toBe(201);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      expect(res.body.id).toBeDefined();
      expect(res.body.email).toBe('new.cashier.a71@2x1burgerco.local');
      expect(res.body.fullName).toBe('Nuevo Cajero A71');
      expect(res.body.isActive).toBe(true);
      expect(res.body.hasAccessCode).toBe(false);
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(res.body.roles.map((role: { name: string }) => role.name)).toContain('cashier');

      // The created user must actually persist a real bcrypt hash server-side — the fix only
      // changes the HTTP response shape, never the underlying credential storage.
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(persisted.passwordHash).toBeTruthy();
      expect(persisted.passwordHash).not.toBe('NewCashier98765*');
    });
  });

  describe('PATCH /users/:id', () => {
    it('FIXED: response contains no passwordHash/accessCodeHash anywhere after a password rotation', async () => {
      const adminToken = await loginAsAdmin('10.71.2');
      const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@2x1burgerco.local' } });

      const res = await request(app.getHttpServer())
        .patch(`/users/${cashier.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'RotatedCashierA71-98765*' });
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      expect(res.body.id).toBe(cashier.id);
      expect(res.body.email).toBe('cashier@2x1burgerco.local');
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(res.body.roles.map((role: { name: string }) => role.name)).toContain('cashier');
    });

    it('FIXED: response contains no accessCodeHash after an operational-role (waiter) accessCode rotation', async () => {
      const adminToken = await loginAsAdmin('10.71.3');
      const waiter = await prisma.user.findUniqueOrThrow({ where: { email: 'waiter@2x1burgerco.local' } });

      const res = await request(app.getHttpServer())
        .patch(`/users/${waiter.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accessCode: 'NEWCODEA71' });
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      expect(res.body.id).toBe(waiter.id);
      expect(res.body.hasAccessCode).toBe(true);
      expect(res.body.accessName).toBeTruthy();
    });
  });

  describe('PATCH /users/:id/status', () => {
    it('FIXED: response contains no passwordHash/accessCodeHash, and DOES contain isActive + roles', async () => {
      const adminToken = await loginAsAdmin('10.71.4');
      const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@2x1burgerco.local' } });

      const res = await request(app.getHttpServer())
        .patch(`/users/${cashier.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');

      expect(res.body.id).toBe(cashier.id);
      expect(res.body.isActive).toBe(false);
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(res.body.roles.map((role: { name: string }) => role.name)).toContain('cashier');
    });
  });

  describe('GET /users (regression guard — the already-safe reference shape must be untouched)', () => {
    it('still contains no passwordHash/accessCodeHash and the same shared safe shape', async () => {
      const adminToken = await loginAsAdmin('10.71.5');

      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('accessCodeHash');
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('hasAccessCode');
      expect(res.body[0]).toHaveProperty('roles');
    });
  });
});
