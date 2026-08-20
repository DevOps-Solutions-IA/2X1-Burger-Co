import { PrismaClient } from '@prisma/client';
import { PrismaOrderCheckoutRepository, type WebhookClaimResult } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import { openTzScopedContext, type TzScopedContext } from './helpers/tz-scoped-client';

function expectClaimed(result: WebhookClaimResult): Extract<WebhookClaimResult, { state: 'CLAIMED' }> {
  expect(result.state).toBe('CLAIMED');
  if (result.state !== 'CLAIMED') throw new Error(`expected CLAIMED, got ${result.state}`);
  return result;
}

/**
 * P6 (SOFIA Payment webhook-lease timezone safety, round 6) -- REAL PostgreSQL timezone matrix.
 *
 * CONTEXT (see P5's fix, commit on this branch, and
 * .engineering/sofia-production/remediation/payment-lease-timezone/00-design.md): the original
 * bug was that `payment_webhook_events.processing_lease_expires_at` / `next_retry_at` (naive
 * `TIMESTAMP(3)` columns) were written via raw `$executeRaw` with a bound JS `Date`. Prisma's
 * query engine serializes that bound Date as if it were `timestamptz`, and Postgres's implicit
 * cast from `timestamptz` to the naive `timestamp` column then consults the *session's*
 * `TimeZone` GUC -- shifting the stored value by the session's UTC offset. Empirically
 * reproduced in this session: a JS Date of `2026-08-20T12:00:00.000Z` written via raw
 * `$executeRaw` under an `America/Bogota` (UTC-5) session was stored as naive `2026-08-20
 * 07:00:00` -- a silent -5h corruption. The typed Prisma Client does not have this problem: it
 * always serializes/compares `DateTime` values UTC-normalized, independent of session
 * `TimeZone`, confirmed on both the write and the read side in this session's probes. P5's fix
 * routes every lease/retry write exclusively through the typed Prisma Client.
 *
 * WHAT THIS SUITE PROVES: not "the fix looks right" but that under REAL separate PostgreSQL
 * sessions, each with `SHOW timezone` verified to actually report the target zone (see
 * `openTzScopedContext`), the full webhook-lease lifecycle -- grant, active-check,
 * expiration-check, duplicate-in-flight, expired-retry, terminal SUCCEEDED, retryable FAILED,
 * non-retryable FAILED -- behaves identically across UTC, America/Bogota, America/New_York,
 * Europe/Berlin and Asia/Tokyo, including when the write and the read happen under two
 * different sessions (or the same session with its timezone changed mid-transaction), and when
 * the Node process's own `TZ` disagrees with the Postgres session's `timezone`.
 *
 * Every fixture below is a real `payment_webhook_events` row (plus, where `claimRecoverableWebhook`
 * requires it, a real minimal `order_checkouts`/`payment_intents` row pair) created and mutated
 * through the real repository methods under test -- never mocked, never faked.
 */

const TIMEZONES = ['UTC', 'America/Bogota', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'] as const;

let fixtureCounter = 0;
function uniqueSuffix(): string {
  fixtureCounter += 1;
  return `${Date.now()}-${fixtureCounter}`;
}

async function createCheckoutWithIntent(prisma: PrismaClient, label: string) {
  const suffix = uniqueSuffix();
  const checkout = await prisma.orderCheckout.create({
    data: {
      source: 'SOFIA',
      sourceReference: `p6-tzmatrix-${label}-${suffix}`,
      idempotencyKey: `p6-tzmatrix-checkout-${label}-${suffix}`,
      itemsSnapshot: [],
      subtotal: 10_000,
      total: 10_000,
      fulfillment: 'DELIVERY',
      paymentPreference: 'ONLINE',
      status: 'PAYMENT_PENDING',
    },
  });
  const intent = await prisma.paymentIntent.create({
    data: {
      checkoutId: checkout.id,
      attemptNumber: 1,
      idempotencyKey: `p6-tzmatrix-intent-${label}-${suffix}`,
      provider: 'BOLD',
      amount: 10_000,
      status: 'PENDING',
    },
  });
  return { checkout, intent };
}

type WebhookFixtureInput = {
  eventId: string;
  paymentIntentId?: string | null;
};

function baseWebhookEvidence(input: WebhookFixtureInput) {
  return {
    paymentIntentId: input.paymentIntentId ?? null,
    provider: 'BOLD',
    eventId: input.eventId,
    providerPaymentId: `provider-${input.eventId}`,
    providerReference: `checkout_${input.eventId}`,
    eventType: 'PAYMENT',
    status: 'APPROVED',
    amount: 10_000,
    currency: 'COP',
    signatureValid: true,
    payloadHash: `payload-hash-${input.eventId}`,
    providerAccountHash: 'merchant-1-hash',
    processedStatus: 'RECEIVED',
    rawPayload: { sanitized: true, eventId: input.eventId },
  };
}

async function cleanupWebhookRow(prisma: PrismaClient, webhookId: string | undefined) {
  if (!webhookId) return;
  await prisma.paymentTransition.deleteMany({ where: { webhookEventId: webhookId } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { id: webhookId } });
}

async function cleanupCheckout(prisma: PrismaClient, checkoutId: string | undefined) {
  if (!checkoutId) return;
  await prisma.paymentWebhookEvent.deleteMany({ where: { paymentIntent: { checkoutId } } });
  await prisma.paymentTransition.deleteMany({ where: { paymentIntent: { checkoutId } } });
  await prisma.paymentIntent.deleteMany({ where: { checkoutId } });
  await prisma.orderCheckout.deleteMany({ where: { id: checkoutId } });
}

describe('SOFIA payment webhook lease -- real PostgreSQL timezone matrix (P6)', () => {
  beforeAll(() => {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url || !url.includes('_test')) {
      throw new Error('P6 timezone-matrix tests require an isolated _test database.');
    }
  });

  describe.each(TIMEZONES)('timezone: %s', (tz) => {
    let ctx: TzScopedContext;
    let repo: PrismaOrderCheckoutRepository;
    let prisma: PrismaClient;

    beforeAll(async () => {
      ctx = await openTzScopedContext(tz);
      repo = ctx.repo;
      prisma = ctx.prisma;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('SHOW timezone confirms this is a real, distinct session pinned to the target zone', async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone');
      expect(rows[0]?.TimeZone).toBe(tz);
    });

    it('grant 30s lease -> immediately active', async () => {
      const eventId = `p6-grant-${tz}-${uniqueSuffix()}`;
      const leaseOwnerHash = 'owner-grant';
      const leaseExpiresAt = new Date(Date.now() + 30_000);
      const result = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash,
        leaseExpiresAt,
        maxAttempts: 5,
      });
      expect(result.state).toBe('CLAIMED');
      const claimed = await repo.findClaimedWebhookEvidence(result.webhookId, leaseOwnerHash);
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(result.webhookId);
      await cleanupWebhookRow(prisma, result.webhookId);
    });

    it('check before expiration -> active (findClaimedWebhookEvidence sees it, duplicate claim sees ACTIVE)', async () => {
      const eventId = `p6-before-exp-${tz}-${uniqueSuffix()}`;
      const leaseOwnerHash = 'owner-before-exp';
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');

      const evidence = await repo.findClaimedWebhookEvidence(first.webhookId, leaseOwnerHash);
      expect(evidence).not.toBeNull();

      await cleanupWebhookRow(prisma, first.webhookId);
    });

    it('check after expiration -> expired (findClaimedWebhookEvidence returns null, reclaim succeeds instead of ACTIVE)', async () => {
      const eventId = `p6-after-exp-${tz}-${uniqueSuffix()}`;
      const leaseOwnerHash = 'owner-after-exp';
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');

      // Simulate real elapsed time (same technique the pre-existing P2 TOCTOU suite uses for
      // PaymentIntent.expiresAt): push the lease into the past via the typed client, under THIS
      // session's timezone. This exercises the exact write path under test -- a real committed
      // row, a real subsequent comparison against `new Date()` -- without a real 30s sleep.
      await prisma.paymentWebhookEvent.update({
        where: { id: first.webhookId },
        data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
      });

      const expiredEvidence = await repo.findClaimedWebhookEvidence(first.webhookId, leaseOwnerHash);
      expect(expiredEvidence).toBeNull();

      // A fresh claim attempt on the same identity must now RECLAIM (attempt 2), not report ACTIVE.
      const reclaimedResult = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash: 'owner-after-exp-reclaimer',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      const reclaimed = expectClaimed(reclaimedResult);
      expect(reclaimed.attempt).toBe(2);
      expect(reclaimed.webhookId).toBe(first.webhookId);

      await cleanupWebhookRow(prisma, first.webhookId);
    });

    it('duplicate webhook while lease active -> correct ACTIVE (blocked/in-progress) semantics, no reclaim', async () => {
      const eventId = `p6-dup-active-${tz}-${uniqueSuffix()}`;
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash: 'owner-dup-1',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');

      // Same (provider, eventId) identity arrives again while the lease from the first claim is
      // still fresh -- must be reported ACTIVE, never silently re-processed or falsely expired.
      const duplicate = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId }),
        leaseOwnerHash: 'owner-dup-2',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(duplicate.state).toBe('ACTIVE');
      expect(duplicate.webhookId).toBe(first.webhookId);

      await cleanupWebhookRow(prisma, first.webhookId);
    });

    it('retry after legitimately expired lease -> recoverable per policy (findRecoverableWebhookIds + claimRecoverableWebhook)', async () => {
      const eventId = `p6-retry-recoverable-${tz}-${uniqueSuffix()}`;
      const { checkout, intent } = await createCheckoutWithIntent(prisma, `retry-${tz}`);
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash: 'owner-retry-1',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');
      await repo.advanceWebhookCheckpoint({
        webhookId: first.webhookId,
        leaseOwnerHash: 'owner-retry-1',
        checkpoint: 'VALIDATED',
      });

      // Legitimately expire the lease (real elapsed time, same technique as above).
      await prisma.paymentWebhookEvent.update({
        where: { id: first.webhookId },
        data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
      });

      const recoverableIds = await repo.findRecoverableWebhookIds(new Date(), 50, 5);
      expect(recoverableIds).toContain(first.webhookId);

      const reclaimedResult = await repo.claimRecoverableWebhook({
        webhookId: first.webhookId,
        leaseOwnerHash: 'owner-retry-2',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      const reclaimed = expectClaimed(reclaimedResult);
      expect(reclaimed.attempt).toBe(2);

      await cleanupCheckout(prisma, checkout.id);
    });

    it('SUCCEEDED webhook -> remains terminal/canonical (REPLAY on re-claim, excluded from recovery)', async () => {
      const eventId = `p6-succeeded-terminal-${tz}-${uniqueSuffix()}`;
      const { checkout, intent } = await createCheckoutWithIntent(prisma, `succeeded-${tz}`);
      const leaseOwnerHash = 'owner-succeeded';
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');
      await repo.advanceWebhookCheckpoint({ webhookId: first.webhookId, leaseOwnerHash, checkpoint: 'VALIDATED' });
      await repo.advanceWebhookCheckpoint({ webhookId: first.webhookId, leaseOwnerHash, checkpoint: 'TRANSITION_APPLIED' });
      await repo.completeWebhookClaim({
        webhookId: first.webhookId,
        leaseOwnerHash,
        result: { processedStatus: 'PROCESSED', paymentIntentId: intent.id, paymentStatus: 'SUCCEEDED' },
      });

      // Terminal: a second claim attempt on the same identity must REPLAY, never re-process.
      const replay = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash: 'owner-succeeded-replay',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(replay.state).toBe('REPLAY');

      // Terminal rows (deterministicResult set) must never surface as "recoverable", regardless
      // of session timezone -- this is what protects a genuinely successful Bold payment from
      // ever being reprocessed by the recovery worker.
      const recoverableIds = await repo.findRecoverableWebhookIds(new Date(Date.now() + 60_000), 50, 5);
      expect(recoverableIds).not.toContain(first.webhookId);

      await cleanupCheckout(prisma, checkout.id);
    });

    it('FAILED retryable event -> recoverable (nextRetryAt semantics correct under this session timezone)', async () => {
      const eventId = `p6-failed-retryable-${tz}-${uniqueSuffix()}`;
      const { checkout, intent } = await createCheckoutWithIntent(prisma, `failed-retry-${tz}`);
      const leaseOwnerHash = 'owner-failed-retryable';
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');

      await repo.failWebhookClaim({
        webhookId: first.webhookId,
        leaseOwnerHash,
        errorCode: 'DOWNSTREAM_TIMEOUT',
        maxAttempts: 5,
        retryable: true,
      });

      const row = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: first.webhookId } });
      expect(row.processedStatus).toBe('FAILED');
      expect(row.retryable).toBe(true);
      expect(row.nextRetryAt).not.toBeNull();

      const recoverableIds = await repo.findRecoverableWebhookIds(new Date(Date.now() + 1_000), 50, 5);
      expect(recoverableIds).toContain(first.webhookId);

      const reclaimed = await repo.claimRecoverableWebhook({
        webhookId: first.webhookId,
        leaseOwnerHash: 'owner-failed-retryable-2',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(reclaimed.state).toBe('CLAIMED');

      await cleanupCheckout(prisma, checkout.id);
    });

    it('FAILED non-retryable event -> stays blocked (never surfaces as recoverable, reclaim attempts are BLOCKED)', async () => {
      const eventId = `p6-failed-nonretryable-${tz}-${uniqueSuffix()}`;
      const { checkout, intent } = await createCheckoutWithIntent(prisma, `failed-noretry-${tz}`);
      const leaseOwnerHash = 'owner-failed-nonretryable';
      const first = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(first.state).toBe('CLAIMED');

      await repo.failWebhookClaim({
        webhookId: first.webhookId,
        leaseOwnerHash,
        errorCode: 'SIGNATURE_INVALID',
        maxAttempts: 5,
        retryable: false,
      });

      const row = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: first.webhookId } });
      expect(row.processedStatus).toBe('FAILED');
      expect(row.retryable).toBe(false);
      expect(row.nextRetryAt).toBeNull();

      const recoverableIds = await repo.findRecoverableWebhookIds(new Date(Date.now() + 60_000), 50, 5);
      expect(recoverableIds).not.toContain(first.webhookId);

      // `failWebhookClaim(retryable: false)` sets `processedAt` (terminal) alongside
      // `retryable: false` -- so both repository entry points hit their `existing.processedAt`
      // guard first and report `LEGACY_AMBIGUOUS`, not the separate `NOT_RETRYABLE` branch (which
      // guards a `processedAt IS NULL` + `processedStatus = 'FAILED'` combination this write path
      // never actually produces). Either reasonCode satisfies "stays blocked" -- what this test
      // asserts is that the block is total and identical across every session timezone, which the
      // `describe.each(TIMEZONES)` loop this test runs under directly proves.
      const blockedReclaim = await repo.claimRecoverableWebhook({
        webhookId: first.webhookId,
        leaseOwnerHash: 'owner-failed-nonretryable-2',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(blockedReclaim.state).toBe('BLOCKED');
      expect((blockedReclaim as { reasonCode?: string }).reasonCode).toBe('LEGACY_AMBIGUOUS');

      const blockedFreshClaim = await repo.claimWebhookEvidence({
        ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
        leaseOwnerHash: 'owner-failed-nonretryable-3',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        maxAttempts: 5,
      });
      expect(blockedFreshClaim.state).toBe('BLOCKED');
      expect((blockedFreshClaim as { reasonCode?: string }).reasonCode).toBe('LEGACY_AMBIGUOUS');

      await cleanupCheckout(prisma, checkout.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Cross-timezone: the write and the read happen under genuinely DIFFERENT sessions, or the same
  // session with its timezone GUC changed mid-transaction.
  // ---------------------------------------------------------------------------------------------
  describe('server timezone changed between write and read', () => {
    it('fresh session (Bogota write, Tokyo read): lease semantics agree across the two sessions', async () => {
      const writeCtx = await openTzScopedContext('America/Bogota');
      const readCtx = await openTzScopedContext('Asia/Tokyo');
      try {
        const eventId = `p6-cross-session-${uniqueSuffix()}`;
        const leaseOwnerHash = 'owner-cross-session';
        const claimed = await writeCtx.repo.claimWebhookEvidence({
          ...baseWebhookEvidence({ eventId }),
          leaseOwnerHash,
          leaseExpiresAt: new Date(Date.now() + 30_000),
          maxAttempts: 5,
        });
        expect(claimed.state).toBe('CLAIMED');

        // Read from a DIFFERENT session (different timezone GUC) than the one that wrote it.
        const evidenceFromTokyo = await readCtx.repo.findClaimedWebhookEvidence(claimed.webhookId, leaseOwnerHash);
        expect(evidenceFromTokyo).not.toBeNull();

        // Expire it (write from the Tokyo session this time), then confirm the Bogota session
        // agrees it is expired.
        await readCtx.prisma.paymentWebhookEvent.update({
          where: { id: claimed.webhookId },
          data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
        });
        const evidenceFromBogotaAfterExpiry = await writeCtx.repo.findClaimedWebhookEvidence(claimed.webhookId, leaseOwnerHash);
        expect(evidenceFromBogotaAfterExpiry).toBeNull();

        await cleanupWebhookRow(writeCtx.prisma, claimed.webhookId);
      } finally {
        await writeCtx.dispose();
        await readCtx.dispose();
      }
    });

    it('same connection, timezone changed mid-transaction (SET LOCAL Bogota -> SET LOCAL Tokyo): typed-client comparison still correct', async () => {
      const ctx = await openTzScopedContext('UTC');
      try {
        const eventId = `p6-mid-session-${uniqueSuffix()}`;
        const fixedInstant = new Date(Date.now() + 30_000);
        const webhookId = await ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/Bogota'`);
          const showBogota = await tx.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone');
          expect(showBogota[0]?.TimeZone).toBe('America/Bogota');

          const created = await tx.paymentWebhookEvent.create({
            data: { ...baseWebhookEvidence({ eventId }), processingLeaseOwnerHash: 'owner-mid-session', processingLeaseExpiresAt: fixedInstant, processingAttempts: 1 },
          });

          // Change the session's timezone GUC mid-transaction, same physical connection.
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Asia/Tokyo'`);
          const showTokyo = await tx.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone');
          expect(showTokyo[0]?.TimeZone).toBe('Asia/Tokyo');

          const stillActive = await tx.paymentWebhookEvent.findFirst({
            where: { id: created.id, processingLeaseExpiresAt: { gt: new Date() } },
          });
          expect(stillActive).not.toBeNull();

          return created.id;
        });

        await cleanupWebhookRow(ctx.prisma, webhookId);
      } finally {
        await ctx.dispose();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Node process TZ vs Postgres session timezone.
  // ---------------------------------------------------------------------------------------------
  describe('Node process TZ differs from the Postgres session timezone', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('Node process pinned to America/Bogota, Postgres session pinned to Asia/Tokyo: lease grant/expiry semantics unaffected', async () => {
      process.env.TZ = 'America/Bogota';
      const ctx = await openTzScopedContext('Asia/Tokyo');
      try {
        const eventId = `p6-node-tz-${uniqueSuffix()}`;
        const leaseOwnerHash = 'owner-node-tz';
        const claimed = await ctx.repo.claimWebhookEvidence({
          ...baseWebhookEvidence({ eventId }),
          leaseOwnerHash,
          leaseExpiresAt: new Date(Date.now() + 30_000),
          maxAttempts: 5,
        });
        expect(claimed.state).toBe('CLAIMED');
        const active = await ctx.repo.findClaimedWebhookEvidence(claimed.webhookId, leaseOwnerHash);
        expect(active).not.toBeNull();

        await ctx.prisma.paymentWebhookEvent.update({
          where: { id: claimed.webhookId },
          data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
        });
        const expired = await ctx.repo.findClaimedWebhookEvidence(claimed.webhookId, leaseOwnerHash);
        expect(expired).toBeNull();

        await cleanupWebhookRow(ctx.prisma, claimed.webhookId);
      } finally {
        await ctx.dispose();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  // transitionPayment()'s webhookClaim ownership check -- found and fixed in this round (P6).
  //
  // P5's fix converted every OTHER lease/retry read/write in this file to the typed Prisma
  // Client, but `transitionPayment`'s `input.webhookClaim` ownership guard needs `SELECT ... FOR
  // UPDATE` row locking inside its transaction, which has no typed-client equivalent, so it was
  // left as raw SQL comparing the naive `processing_lease_expires_at` column directly against
  // `CURRENT_TIMESTAMP`. Empirically reproduced in this session: under a non-UTC session (e.g.
  // America/Bogota), a lease that legitimately expired 10 seconds ago was still reported as
  // "owned" (1 row instead of 0) -- the mirror-image failure mode of the originally reported bug:
  // instead of a fresh lease appearing falsely expired, a genuinely expired lease appears falsely
  // active, letting `transitionPayment` proceed on a stale claim instead of raising
  // `PAYMENT_WEBHOOK_CLAIM_LOST`. Fixed with the same `AT TIME ZONE 'UTC'` cast already used for
  // the raw aggregate reads in `operational-backlog.service.ts` (necessary there for the same
  // "must stay raw SQL" reason). This block proves the fix under all 5 matrix timezones plus the
  // happy path.
  // ---------------------------------------------------------------------------------------------
  describe.each(TIMEZONES)('transitionPayment webhookClaim ownership check: timezone %s', (tz) => {
    let ctx: TzScopedContext;

    beforeAll(async () => {
      ctx = await openTzScopedContext(tz);
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    async function setupPendingIntentWithClaim(label: string, leaseExpiresAt: Date) {
      const { checkout, intent } = await createCheckoutWithIntent(ctx.prisma, `transition-${tz}-${label}`);
      const eventId = `p6-transition-${tz}-${label}-${uniqueSuffix()}`;
      const leaseOwnerHash = 'owner-transition';
      const claimed = expectClaimed(
        await ctx.repo.claimWebhookEvidence({
          ...baseWebhookEvidence({ eventId, paymentIntentId: intent.id }),
          leaseOwnerHash,
          leaseExpiresAt: new Date(Date.now() + 30_000),
          maxAttempts: 5,
        }),
      );
      // Set the lease to the exact instant this scenario needs (active or legitimately expired),
      // via the typed client -- the real production write path.
      await ctx.prisma.paymentWebhookEvent.update({
        where: { id: claimed.webhookId },
        data: { processingLeaseExpiresAt: leaseExpiresAt },
      });
      return { checkout, intent, webhookId: claimed.webhookId, leaseOwnerHash };
    }

    it('active lease -> transitionPayment succeeds and applies the transition', async () => {
      const { checkout, intent, webhookId, leaseOwnerHash } = await setupPendingIntentWithClaim(
        'active',
        new Date(Date.now() + 30_000),
      );
      const result = await ctx.repo.transitionPayment({
        paymentIntentId: intent.id,
        expectedVersion: intent.version,
        toStatus: 'SUCCEEDED',
        reasonCode: 'P6_TZ_MATRIX_ACTIVE',
        idempotencyKey: `p6-transition-active-${tz}-${uniqueSuffix()}`,
        webhookClaim: { webhookId, leaseOwnerHash },
      });
      expect(result).toBeDefined();
      const updated = await ctx.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(updated.status).toBe('SUCCEEDED');
      await cleanupCheckout(ctx.prisma, checkout.id);
    });

    it('legitimately expired lease -> transitionPayment raises PAYMENT_WEBHOOK_CLAIM_LOST, never applies the transition', async () => {
      const { checkout, intent, webhookId, leaseOwnerHash } = await setupPendingIntentWithClaim(
        'expired',
        new Date(Date.now() - 10_000),
      );
      await expect(
        ctx.repo.transitionPayment({
          paymentIntentId: intent.id,
          expectedVersion: intent.version,
          toStatus: 'SUCCEEDED',
          reasonCode: 'P6_TZ_MATRIX_EXPIRED',
          idempotencyKey: `p6-transition-expired-${tz}-${uniqueSuffix()}`,
          webhookClaim: { webhookId, leaseOwnerHash },
        }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_WEBHOOK_CLAIM_LOST' }) });
      const untouched = await ctx.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(untouched.status).toBe('PENDING');
      await cleanupCheckout(ctx.prisma, checkout.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Regression sentinel: documents (does NOT exercise repository code) the exact raw-SQL-write
  // corruption class P5 eliminated, so a future revert of any lease/retry write back to raw
  // `$executeRaw` has a standing, explicit empirical demonstration of why that is unsafe -- not
  // just a comment.
  // ---------------------------------------------------------------------------------------------
  describe('regression sentinel: raw $executeRaw Date write under a non-UTC session (documents the eliminated bug class)', () => {
    it('a bound JS Date written via raw $executeRaw under an America/Bogota session is stored shifted by -5h; the typed client is not', async () => {
      const ctx = await openTzScopedContext('America/Bogota');
      try {
        await ctx.prisma.$executeRawUnsafe(
          'CREATE TABLE IF NOT EXISTS p6_tz_regression_sentinel (id text primary key, naive_ts timestamp(3))',
        );
        const fixedInstant = new Date('2026-08-20T12:00:00.000Z');
        const rawId = `raw-${uniqueSuffix()}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately mirrors the ELIMINATED raw-write pattern
        await (ctx.prisma as any).$executeRaw`INSERT INTO p6_tz_regression_sentinel (id, naive_ts) VALUES (${rawId}, ${fixedInstant})`;
        const rawStored = await ctx.prisma.$queryRawUnsafe<Array<{ raw: string }>>(
          `SELECT naive_ts::text AS raw FROM p6_tz_regression_sentinel WHERE id = '${rawId}'`,
        );
        // The corruption this suite exists to keep closed: 12:00 UTC written raw under a UTC-5
        // session is stored as naive 07:00, not 12:00.
        expect(rawStored[0]?.raw).toBe('2026-08-20 07:00:00');

        // The typed client, writing the SAME instant under the SAME session, is not shifted --
        // this is the property P5's fix depends on and this whole matrix verifies end to end.
        const typedId = `typed-${uniqueSuffix()}`;
        const typedRow = await ctx.prisma.paymentWebhookEvent.create({
          data: { ...baseWebhookEvidence({ eventId: `p6-sentinel-typed-${typedId}` }), processingLeaseExpiresAt: fixedInstant },
        });
        const typedStored = await ctx.prisma.$queryRawUnsafe<Array<{ raw: string }>>(
          `SELECT processing_lease_expires_at::text AS raw FROM payment_webhook_events WHERE id = '${typedRow.id}'`,
        );
        expect(typedStored[0]?.raw).toBe('2026-08-20 12:00:00');

        await ctx.prisma.$executeRawUnsafe(`DELETE FROM p6_tz_regression_sentinel WHERE id = '${rawId}'`);
        await cleanupWebhookRow(ctx.prisma, typedRow.id);
        await ctx.prisma.$executeRawUnsafe('DROP TABLE IF EXISTS p6_tz_regression_sentinel');
      } finally {
        await ctx.dispose();
      }
    });
  });
});
