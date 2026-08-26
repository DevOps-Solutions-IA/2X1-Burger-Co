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
 * A56/A57 (round 5) — cross-module RBAC bypass on the shared `OperationalAlert` table,
 * FIXED and asserted permanently below.
 *
 * ORIGINAL FINDING (A56, HIGH): `GET /orders/operational-alerts` and
 * `PATCH /orders/operational-alerts/:id` (`OrdersController`, backed by
 * `OrdersService.listOperationalAlerts` / `updateOperationalAlert`) shared the SAME underlying
 * `OperationalAlert` table used by SOFIA's governance/production-safety alerting
 * (`module: 'sofia'`, created by `SofiaAlertsService.check()` for things like
 * `SOFIA_REAL_SEND_ATTEMPT_BLOCKED` — a signal that a real WhatsApp/production send was
 * attempted while `realSendingEnabled=false` — and `SOFIA_NO_ACTIVE_PROMPT`), but applied NO
 * module-based authorization scoping. A `waiter` — explicitly rejected with 403 by the
 * dedicated, correctly-gated `GET/POST /admin/sofia/alerts*` routes
 * (`@Roles('admin','supervisor')` + `settings.read`/`settings.update`) — could read AND
 * silently RESOLVE CRITICAL SOFIA governance alerts through this sibling, unscoped route,
 * undermining the observability signal Runtime Safety depends on (CLAUDE.md section 9).
 *
 * FIX (A57): `OrdersService` now enforces a static module allowlist
 * (`ORDERS_OPERATIONAL_ALERT_MODULES = ['orders', 'deliveries', 'waiters']` — the only modules
 * this service itself ever creates alerts under) on BOTH `listOperationalAlerts` and
 * `updateOperationalAlert`. Any alert whose `module` is outside that allowlist — in particular
 * `module: 'sofia'` — can no longer be read (explicit `?module=sofia` query, or implicitly via
 * the default unfiltered listing) or mutated through `/orders/operational-alerts*`, regardless
 * of the caller's role or permissions, including `admin`. This makes `/admin/sofia/alerts*` the
 * single, non-duplicated authorization surface for `module: 'sofia'` alerts, eliminating the
 * drift between two routes over the same resource. Legitimate POS/kitchen/delivery/waiter
 * alert traffic through `/orders/operational-alerts*` is unaffected.
 */
describe('A56/A57 — SOFIA governance alerts are no longer reachable via /orders/operational-alerts (cross-module RBAC bypass, FIXED)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A56/A57 tests require an isolated _test database.');
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

  it('CONTROL: /admin/sofia/alerts (the dedicated, correctly-gated route for the same data) rejects a waiter with 403', async () => {
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

  it('FIXED: a waiter can no longer list a CRITICAL module:"sofia" governance alert through GET /orders/operational-alerts?module=sofia', async () => {
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

    const explicitModuleResponse = await request(app.getHttpServer())
      .get('/orders/operational-alerts')
      .query({ module: 'sofia' })
      .set('Authorization', `Bearer ${waiterToken}`);

    // The fix: an explicit ?module=sofia query is now rejected outright, the same way the
    // dedicated /admin/sofia/alerts route rejects a waiter.
    expect(explicitModuleResponse.status).toBe(403);

    const defaultListResponse = await request(app.getHttpServer())
      .get('/orders/operational-alerts')
      .set('Authorization', `Bearer ${waiterToken}`);

    // Also confirm the SOFIA alert cannot leak through the unfiltered default listing either.
    expect(defaultListResponse.status).toBe(200);
    const leaked = (defaultListResponse.body as Array<{ id: string }>).find(
      (alert) => alert.id === sofiaAlert.id,
    );
    expect(leaked).toBeUndefined();
  });

  it('FIXED: a waiter can no longer RESOLVE a CRITICAL module:"sofia" governance alert through PATCH /orders/operational-alerts/:id', async () => {
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

    // The fix: rejected with 403 — the module-scope check now runs before any mutation.
    expect(patchResponse.status).toBe(403);

    const persisted = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: sofiaAlert.id } });
    expect(persisted.status).toBe(OperationalAlertStatus.OPEN);
    expect(persisted.resolvedById).toBeNull();

    // The dedicated SOFIA ack route still rejects the same waiter for the same alert id — the
    // authorization boundary is now consistent across both routes instead of silently diverging.
    const sofiaAckResponse = await request(app.getHttpServer())
      .post(`/admin/sofia/alerts/${sofiaAlert.id}/ack`)
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(sofiaAckResponse.status).toBe(403);
  });

  it('FIXED: even an admin can no longer resolve a module:"sofia" alert through /orders/operational-alerts — /admin/sofia/alerts/:id/ack is now the single authorized path', async () => {
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

    // The formerly-passing "positive control" (admin resolving a sofia alert via the
    // orders-side route) exercised exactly the unscoped, duplicated authorization surface this
    // fix removes. That capability is not a legitimate use to preserve: SOFIA alerts now have
    // exactly one authorized route, regardless of caller role.
    const patchResponse = await request(app.getHttpServer())
      .patch(`/orders/operational-alerts/${sofiaAlert.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' });
    expect(patchResponse.status).toBe(403);

    const stillOpen = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: sofiaAlert.id } });
    expect(stillOpen.status).toBe(OperationalAlertStatus.OPEN);

    // The admin retains full, correct access through the dedicated SOFIA route.
    const ackResponse = await request(app.getHttpServer())
      .post(`/admin/sofia/alerts/${sofiaAlert.id}/ack`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ackResponse.status).toBe(201);

    const resolved = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: sofiaAlert.id } });
    expect(resolved.status).not.toBe(OperationalAlertStatus.OPEN);
  });

  it('POSITIVE CONTROL (legitimate use preserved): a waiter can still list and resolve a POS-relevant module:"orders" alert through /orders/operational-alerts exactly as before', async () => {
    await seedTestData(prisma);

    const ordersAlert = await prisma.operationalAlert.create({
      data: {
        type: 'WAITER_ORDER_READY_FOR_PAYMENT',
        module: 'orders',
        severity: OperationalAlertSeverity.WARNING,
        status: OperationalAlertStatus.OPEN,
        title: 'Comanda lista para cobro',
        message: 'La comanda quedó lista para cobro en caja.',
        entityType: 'order_ticket',
      },
    });

    const waiterToken = await waiterLogin('10.6.5.1');

    const listResponse = await request(app.getHttpServer())
      .get('/orders/operational-alerts')
      .query({ module: 'orders' })
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(listResponse.status).toBe(200);
    const found = (listResponse.body as Array<{ id: string; module: string }>).find(
      (alert) => alert.id === ordersAlert.id,
    );
    expect(found).toBeDefined();
    expect(found!.module).toBe('orders');

    const patchResponse = await request(app.getHttpServer())
      .patch(`/orders/operational-alerts/${ordersAlert.id}`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ status: 'RESOLVED' });
    expect(patchResponse.status).toBe(200);

    const persisted = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: ordersAlert.id } });
    expect(persisted.status).toBe(OperationalAlertStatus.RESOLVED);
    expect(persisted.resolvedById).toBeDefined();
  });
});
