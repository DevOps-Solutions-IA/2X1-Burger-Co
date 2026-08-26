import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { OperationalAlertSeverity, OperationalAlertStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import {
  resetDatabase,
  seedTestData,
  WAITER_ACCESS_NAME,
  WAITER_ACCESS_CODE,
} from '../../tests/helpers/test-data';

/**
 * A56 (blind red team, round 5 pass 56) — FINDING (HIGH): `GET /orders/operational-alerts` and
 * `PATCH /orders/operational-alerts/:id` share the SAME underlying `OperationalAlert` table used by
 * SOFIA's governance/production-safety alerting (`module: 'sofia'`, created by
 * `SofiaAlertsService.check()` for things like `SOFIA_REAL_SEND_ATTEMPT_BLOCKED` — a signal that a
 * real WhatsApp/production send was attempted while `realSendingEnabled=false` — and
 * `SOFIA_NO_ACTIVE_PROMPT`), but apply NO module-based authorization scoping.
 *
 * SOFIA exposes its OWN dedicated routes for this exact data —
 * `GET /sofia/alerts`, `POST /sofia/alerts/check`, `POST /sofia/alerts/:id/ack`
 * (`apps/api/src/modules/sofia/sofia.controller.ts` lines ~565-582) — and correctly restricts ALL
 * three to `@Roles('admin', 'supervisor')` + `@Permissions('settings.read'|'settings.update')`. This
 * demonstrates unambiguous INTENT: SOFIA governance alerts are admin/supervisor-only data.
 *
 * `OrdersController` (`apps/api/src/modules/orders/orders.controller.ts` lines 59-74) exposes a
 * SECOND, un-scoped path to the identical rows:
 *   - `GET /orders/operational-alerts` — `@Roles('admin', 'cashier', 'supervisor', 'waiter',
 *     'delivery')`, no `@Permissions` guard at all. `OrdersService.listOperationalAlerts(module?)`
 *     (orders.service.ts ~5055) applies the caller-supplied `module` filter with ZERO restriction on
 *     which modules a given role may query — a waiter can pass `?module=sofia` and read SOFIA's
 *     CRITICAL production-safety alerts verbatim (title/message/metadata).
 *   - `PATCH /orders/operational-alerts/:id` — `@Roles('admin', 'cashier', 'supervisor', 'waiter',
 *     'delivery')` + `@Permissions('orders.update')` (a permission `waiter` DOES hold per
 *     `prisma/seed.ts`). `OrdersService.updateOperationalAlert` (orders.service.ts ~5068) loads the
 *     alert by id and updates its `status` with NO check on `alert.module` / `entityType` at all — a
 *     waiter can silently set ANY alert, including a `module: 'sofia'` CRITICAL governance alert, to
 *     `RESOLVED`.
 *
 * IMPACT: a low-privilege POS `waiter` — who has no `settings.read`/`settings.update` permission and
 * is explicitly excluded from every `/sofia/alerts*` route — can read AND silently dismiss SOFIA's
 * production-safety governance alerts (e.g. an alert that fires specifically because a real
 * WhatsApp/production send was attempted while disabled — the exact kind of guardrail-breach signal
 * CLAUDE.md section 9 requires Runtime Safety to keep observable). This is a full authorization-
 * boundary bypass of an already-established, intentionally admin/supervisor-only control surface,
 * reached through a sibling route that shares the same underlying table without re-applying the
 * module scope.
 */
describe('A56 — waiter can read and silently resolve SOFIA governance alerts via /orders/operational-alerts (cross-module RBAC bypass)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A56 tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function waiterLogin(ip: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', ip)
      .send({ name: WAITER_ACCESS_NAME, accessCode: WAITER_ACCESS_CODE });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function adminLogin(ip: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  it('CONTROL: /sofia/alerts (the dedicated, correctly-gated route for the same data) rejects a waiter with 403', async () => {
    await seedTestData(prisma);
    const waiterToken = await waiterLogin('10.6.1.1');

    const listResponse = await request(app.getHttpServer())
      .get('/admin/sofia/alerts')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(listResponse.status).toBe(403);

    const ackResponse = await request(app.getHttpServer())
      .post('/admin/sofia/alerts/some-fake-id/ack')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(ackResponse.status).toBe(403);
  });

  it('VULNERABLE: a waiter can list a CRITICAL module:"sofia" governance alert through GET /orders/operational-alerts?module=sofia', async () => {
    await seedTestData(prisma);

    const sofiaAlert = await prisma.operationalAlert.create({
      data: {
        type: 'SOFIA_REAL_SEND_ATTEMPT_BLOCKED',
        module: 'sofia',
        severity: OperationalAlertSeverity.CRITICAL,
        status: OperationalAlertStatus.OPEN,
        title: 'Intento de envío real bloqueado',
        message: 'Se detectó intento de envío QR real mientras realSendingEnabled=false.',
        entityType: 'sofia',
        metadata: { generatedBy: 'SOFIA_LEARNING_METRICS_HARDENING_6' },
      },
    });

    const waiterToken = await waiterLogin('10.6.2.1');

    const response = await request(app.getHttpServer())
      .get('/orders/operational-alerts')
      .query({ module: 'sofia' })
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(response.status).toBe(200);
    const found = (response.body as Array<{ id: string; module: string; severity: string }>).find(
      (alert) => alert.id === sofiaAlert.id,
    );
    // THE BUG: the waiter — who is denied by /sofia/alerts entirely — can see the exact same
    // CRITICAL SOFIA governance alert through the sibling /orders/operational-alerts route.
    expect(found).toBeDefined();
    expect(found!.module).toBe('sofia');
    expect(found!.severity).toBe('CRITICAL');
  });

  it('VULNERABLE: a waiter can silently RESOLVE a CRITICAL module:"sofia" governance alert through PATCH /orders/operational-alerts/:id', async () => {
    await seedTestData(prisma);

    const sofiaAlert = await prisma.operationalAlert.create({
      data: {
        type: 'SOFIA_NO_ACTIVE_PROMPT',
        module: 'sofia',
        severity: OperationalAlertSeverity.CRITICAL,
        status: OperationalAlertStatus.OPEN,
        title: 'Prompt maestro no activo',
        message: 'Sofía requiere prompt activo para operar.',
        entityType: 'sofia',
      },
    });

    const waiterToken = await waiterLogin('10.6.3.1');

    const patchResponse = await request(app.getHttpServer())
      .patch(`/orders/operational-alerts/${sofiaAlert.id}`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ status: 'RESOLVED', notes: 'closed by a waiter with no settings.* permission' });

    // THE BUG: succeeds. A waiter, who holds no settings.read/settings.update permission and is
    // rejected outright by every /sofia/alerts* route, can flip a CRITICAL SOFIA governance alert to
    // RESOLVED through the sibling, unscoped /orders route.
    expect(patchResponse.status).toBe(200);

    const persisted = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: sofiaAlert.id } });
    expect(persisted.status).toBe(OperationalAlertStatus.RESOLVED);
    expect(persisted.resolvedById).toBeDefined();

    // Confirm this is genuinely reachable by the lowest-trust role and not merely a permissive
    // dev fixture: the SAME waiter is rejected by the dedicated SOFIA ack route for the SAME alert
    // id, proving the intended authorization boundary is admin/supervisor-only and is bypassed here.
    const sofiaAckResponse = await request(app.getHttpServer())
      .post(`/admin/sofia/alerts/${sofiaAlert.id}/ack`)
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(sofiaAckResponse.status).toBe(403);
  });

  it('POSITIVE CONTROL: an admin resolving the same alert through /orders/operational-alerts is legitimate and works identically', async () => {
    await seedTestData(prisma);

    const sofiaAlert = await prisma.operationalAlert.create({
      data: {
        type: 'SOFIA_NO_ACTIVE_PROMPT',
        module: 'sofia',
        severity: OperationalAlertSeverity.CRITICAL,
        status: OperationalAlertStatus.OPEN,
        title: 'Prompt maestro no activo',
        message: 'Sofía requiere prompt activo para operar.',
        entityType: 'sofia',
      },
    });

    const adminToken = await adminLogin('10.6.4.1');
    const patchResponse = await request(app.getHttpServer())
      .patch(`/orders/operational-alerts/${sofiaAlert.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' });

    expect(patchResponse.status).toBe(200);
  });
});
