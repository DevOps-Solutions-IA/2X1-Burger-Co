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
 * A61 (blind red team, round 5 pass 61) — FINDING (CRITICAL, process/regression): the A56 SOFIA
 * governance-alert cross-module RBAC bypass is STILL LIVE on this branch's HEAD, despite already
 * having been found AND fixed four rounds ago.
 *
 * GIT ARCHAEOLOGY (verified with `git merge-base --is-ancestor` against this worktree's HEAD)
 * -------------------------------------------------------------------------------------------
 * The A56 test commit (82a2914, "test(redteam): A56 blind pass — waiter SOFIA-alert RBAC bypass +
 * unaudited /sales price override") documented TWO independent findings in one pass. Two SIBLING
 * fix commits were built directly on top of it:
 *   - 4082d45 "fix(orders): scope /orders/operational-alerts to POS modules, close SOFIA RBAC
 *     bypass" (branch feat/sofia-remediation-address-round5-57-alert-rbac-fix) — fixes the alert
 *     RBAC bypass by adding an ORDERS_OPERATIONAL_ALERT_MODULES allowlist.
 *   - c9d0033 "fix(sofia): audit /sales price overrides and baseSubtotal discounts (A58)"
 *     (branch feat/sofia-remediation-address-round5-58-sales-audit-fix) — fixes the OTHER A56
 *     finding (unaudited /sales price override).
 *
 * These are SIBLINGS, not a sequential chain: `git merge-base --is-ancestor 4082d45 c9d0033`
 * fails, and `git merge-base --is-ancestor 4082d45 <round5-60 HEAD>` ALSO fails. The round5-59/60
 * lineage that this worktree was built from (feat/sofia-remediation-address-round5-60-cash-
 * current-pii-fix) descends only from c9d0033 — it never merged 4082d45. The alert-RBAC fix was
 * silently dropped by the remediation pipeline's own branch topology, not by any code change.
 *
 * This test re-proves, on THIS worktree's real HEAD, that `orders.a56-operational-alert-cross-
 * module-rbac-bypass.spec.ts` (already present in this repo, unmodified) still passes its
 * "VULNERABLE:" assertions — i.e., the finding is not a residual false-positive, it is a live,
 * currently-exploitable production-safety gap: a `waiter` (lowest-trust POS role) can read AND
 * silently RESOLVE CRITICAL SOFIA governance alerts (e.g. `SOFIA_REAL_SEND_ATTEMPT_BLOCKED`,
 * `SOFIA_NO_ACTIVE_PROMPT`) through `/orders/operational-alerts*`, even though the dedicated,
 * intentionally admin/supervisor-only `/admin/sofia/alerts*` routes correctly reject that same
 * waiter with 403 for the identical alert row.
 *
 * REMEDIATION IS NOT "write new code" — it already exists at commit 4082d45. The actionable fix
 * for the orchestrator is a git operation: merge/cherry-pick 4082d45's `ORDERS_OPERATIONAL_ALERT_
 * MODULES` allowlist (apps/api/src/modules/orders/orders.service.ts,
 * `listOperationalAlerts`/`updateOperationalAlert`) onto this lineage, NOT a fresh redesign.
 */
describe('A61 — orphaned fix regression: A56/A57 SOFIA alert RBAC bypass is live again on round5-60 HEAD', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A61 tests require an isolated _test database.');
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

  it('CONTROL: the dedicated /admin/sofia/alerts route still correctly rejects a waiter (403) — proves the intended boundary', async () => {
    await seedTestData(prisma);
    const waiterToken = await waiterLogin('10.61.1.1');

    const listResponse = await request(app.getHttpServer())
      .get('/admin/sofia/alerts')
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(listResponse.status).toBe(403);
  });

  it('REGRESSION LIVE: a waiter can still list a CRITICAL module:"sofia" governance alert through GET /orders/operational-alerts?module=sofia', async () => {
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
        metadata: { generatedBy: 'A61_ORPHANED_FIX_REGRESSION' },
      },
    });

    const waiterToken = await waiterLogin('10.61.2.1');

    const response = await request(app.getHttpServer())
      .get('/orders/operational-alerts')
      .query({ module: 'sofia' })
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(response.status).toBe(200);
    const found = (response.body as Array<{ id: string; module: string; severity: string }>).find(
      (alert) => alert.id === sofiaAlert.id,
    );
    // If this fails (found is undefined), it means the round5-57 fix (or an equivalent one) HAS
    // been merged onto this lineage since this test was written — treat that as GOOD NEWS and
    // retire this regression test, it will have served its purpose.
    expect(found).toBeDefined();
    expect(found!.module).toBe('sofia');
    expect(found!.severity).toBe('CRITICAL');
  });

  it('REGRESSION LIVE: a waiter can still silently RESOLVE a CRITICAL module:"sofia" governance alert through PATCH /orders/operational-alerts/:id', async () => {
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

    const waiterToken = await waiterLogin('10.61.3.1');

    const patchResponse = await request(app.getHttpServer())
      .patch(`/orders/operational-alerts/${sofiaAlert.id}`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ status: 'RESOLVED', notes: 'A61 regression proof — closed by a waiter with no settings.* permission' });

    expect(patchResponse.status).toBe(200);

    const persisted = await prisma.operationalAlert.findUniqueOrThrow({ where: { id: sofiaAlert.id } });
    expect(persisted.status).toBe(OperationalAlertStatus.RESOLVED);
    expect(persisted.resolvedById).toBeDefined();

    const sofiaAckResponse = await request(app.getHttpServer())
      .post(`/admin/sofia/alerts/${sofiaAlert.id}/ack`)
      .set('Authorization', `Bearer ${waiterToken}`);
    expect(sofiaAckResponse.status).toBe(403);
  });
});
