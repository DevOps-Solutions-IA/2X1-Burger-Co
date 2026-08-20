import { PrismaClient } from '@prisma/client';

/**
 * P3 (independent financial red team, SOFIA Payment TOCTOU remediation) -- ancillary finding.
 *
 * Scope note: this file does NOT touch PK5's TOCTOU race. That race (payment-orchestration
 * .service.ts's createOnlinePaymentLink / prisma-order-checkout.repository.ts's
 * createPaymentIntent) was independently re-verified against P3's own isolated real Postgres
 * instance using P2's exact 12-scenario suite (apps/api/src/tests/payment-toctou-concurrency
 * .integration.spec.ts, unmodified) plus PK5's original PoC -- all pass, under both a UTC-timezone
 * and a non-UTC-timezone Postgres server. See P3's final report for that evidence.
 *
 * This file documents a SEPARATE, pre-existing defect P3 found while empirically re-running EVERY
 * scenario P2 claimed to cover: 2 of P2's 12 scenarios (`existing SUCCEEDED intent: concurrent
 * relink attempts are all blocked`, `duplicate webhook after the PK5 race`) deterministically FAIL
 * against a real Postgres server whose session `timezone` GUC is not UTC (e.g. `America/Bogota`,
 * this project's own business timezone) -- yet PASS when the same server is UTC. Neither commit
 * ab52d7f (P0), c65aa7e (P1), nor 02ebba1 (P2) touched this code path; it is pre-existing behavior
 * in `CanonicalPaymentWebhookService` / `PrismaOrderCheckoutRepository`'s webhook claim/lease
 * machinery (Wave2B / phase6 era), unrelated to the TOCTOU fix itself.
 *
 * Root cause, isolated here independently of the webhook-claim machinery entirely: writing a JS
 * `Date` to a Postgres `timestamp without time zone` column via a raw `$executeRaw` parameter,
 * then reading it back via Prisma's typed Client (`findFirst`/`findUnique`, as
 * `findClaimedWebhookEvidence` does) or via a further raw `$queryRaw`, is corrupted by exactly the
 * server's session `timezone` offset when that offset is not zero (UTC). This is what
 * `claimWebhookEvidence` does when it sets `processing_lease_expires_at` (prisma-order-checkout
 * .repository.ts, both the create path around line ~814 and the reclaim path around line ~890) via
 * `tx.$executeRaw`, which `findClaimedWebhookEvidence` (line ~1041) then reads back via the typed
 * client with `processingLeaseExpiresAt: { gt: new Date() }`.
 *
 * Real-world impact IF a Postgres server's `timezone` is ever configured to something other than
 * UTC (currently NOT the case for this project's actual docker-compose `postgres:16-alpine`
 * service, which sets no `TZ` and defaults to UTC -- confirmed by `SHOW timezone;` against the
 * running `inventario-postgres-1` container returning `UTC`): every real Bold webhook would claim
 * successfully, then immediately fail `PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID` inside
 * `processClaimedWebhook` (canonical-payment-webhook.service.ts:168) because its own
 * just-granted lease appears already expired. `failClaim` then marks the event `FAILED` with
 * `retryable: false` (`PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID` is explicitly excluded from
 * `retryable()`, canonical-payment-webhook.service.ts:450-457), and any webhook redelivery for the
 * same event is thereafter permanently `BLOCKED` / `NOT_RETRYABLE`
 * (prisma-order-checkout.repository.ts:870-872) -- `findRecoverableWebhookIds` only ever picks up
 * `retryable = TRUE` rows, so `recoverPendingBatch` can never rescue it either. Net effect: a
 * genuinely SUCCEEDED Bold payment would never be reflected as SUCCEEDED, the checkout would stay
 * stuck at PAYMENT_PENDING forever, and the order would never reach the kitchen -- with zero
 * automated recovery path, requiring 100% manual reconciliation for every single online payment.
 * This is fail-closed (no double charge, no double order, no wrong amount, no blind retry -- it is
 * a stuck/blocked failure, not a false success), but it is a severe availability/reconciliation
 * defect if the precondition is ever met.
 *
 * This spec is intentionally minimal and self-contained: it reuses only the `payment_webhook_events`
 * table's schema and Prisma's own client, with no dependency on NestJS wiring, so the mechanism is
 * demonstrated in complete isolation from the webhook claim/lease business logic above.
 */
describe('P3 red team: raw $executeRaw Date write vs typed-client Date read on a "timestamp without time zone" column', () => {
  it('demonstrates a systematic offset equal to the Postgres session timezone GUC when non-UTC', async () => {
    const prisma = new PrismaClient();
    await prisma.$connect();

    const tzRows = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW timezone`;
    const serverTimezone = tzRows[0]?.TimeZone ?? 'unknown';

    const created = await prisma.paymentWebhookEvent.create({
      data: { provider: 'BOLD', eventType: 'P3_TZ_REPRO', status: 'P3_TZ_REPRO', signatureValid: true, processedStatus: 'PROCESSING' },
    });

    try {
      // Exactly the write path used by claimWebhookEvidence for processing_lease_expires_at.
      const intended = new Date(Date.now() + 30_000);
      await prisma.$executeRaw`UPDATE payment_webhook_events SET processing_lease_expires_at = ${intended} WHERE id = ${created.id}`;

      // Exactly the read path used by findClaimedWebhookEvidence.
      const viaTypedClient = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: created.id } });
      const readBack = viaTypedClient.processingLeaseExpiresAt!;
      const deltaMs = readBack.getTime() - intended.getTime();

      if (serverTimezone === 'UTC' || serverTimezone === 'Etc/UTC') {
        // On a UTC-timezone server, write and read agree (within normal timestamp(3) rounding).
        expect(Math.abs(deltaMs)).toBeLessThan(1_000);
      } else {
        // On a non-UTC-timezone server, this MUST reproduce: the read-back value is corrupted by
        // exactly the server's UTC offset. If this assertion ever starts failing, the underlying
        // raw-SQL Date write/typed-client Date read mismatch has been fixed upstream (e.g. by
        // moving these writes off $executeRaw, or by making the column `@db.Timestamptz`) and this
        // spec (and the finding it documents) should be retired.
        expect(Math.abs(deltaMs)).toBeGreaterThan(60_000);

        // Directly demonstrates the downstream consequence: findClaimedWebhookEvidence's own
        // `processingLeaseExpiresAt: { gt: new Date() }` filter -- run milliseconds after a claim
        // that set expiresAt 30s in the future -- incorrectly treats the lease as already expired.
        const foundByLeaseFilter = await prisma.paymentWebhookEvent.findFirst({
          where: { id: created.id, processingLeaseExpiresAt: { gt: new Date() } },
        });
        expect(foundByLeaseFilter).toBeNull();
      }
    } finally {
      await prisma.paymentWebhookEvent.delete({ where: { id: created.id } });
      await prisma.$disconnect();
    }
  });
});
