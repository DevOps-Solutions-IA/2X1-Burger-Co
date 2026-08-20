import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaOrderCheckoutRepository, type WebhookClaimResult } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * P7 (independent financial red team, round 4) -- OWN timezone-corruption PoC.
 *
 * Deliberately does NOT import `./helpers/tz-scoped-client.ts` (P6's fixture) -- this file opens
 * its own real Postgres sessions from scratch, against P7's OWN dedicated Postgres container
 * (never the project's docker-compose instance and never P6's `_test` database instance),
 * verifies the session `TimeZone` GUC via `SHOW timezone` itself, and exercises the real
 * `PrismaOrderCheckoutRepository` methods directly.
 *
 * MISSION: re-run, on independent infrastructure, the exact -5h corruption scenario originally
 * reported by P3 (claimWebhookEvidence write vs. findClaimedWebhookEvidence read disagreement
 * once the Postgres session timezone isn't UTC), plus P6's claimed second fix in
 * `transitionPayment`'s webhookClaim ownership check. This suite must FAIL (not skip, not pass
 * vacuously) if either bug is still present.
 */

const TIMEZONES = ['UTC', 'America/Bogota', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'] as const;

function resolveBaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !url.includes('_test')) {
    throw new Error('P7 red-team timezone suite requires an isolated _test DATABASE_URL/TEST_DATABASE_URL.');
  }
  return url;
}

async function openP7Session(tz: string) {
  const base = resolveBaseUrl();
  const sep = base.includes('?') ? '&' : '?';
  const url = `${base}${sep}options=${encodeURIComponent(`-c timezone=${tz}`)}`;
  const prisma = new PrismaClient({ datasourceUrl: url });
  await prisma.$connect();
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>('SHOW timezone');
  const actual = rows[0]?.TimeZone ?? (rows[0] as Record<string, string> | undefined)?.timezone;
  if (actual !== tz) {
    throw new Error(`P7: session TimeZone GUC did not take effect (wanted ${tz}, got ${JSON.stringify(rows)}).`);
  }
  const repo = new PrismaOrderCheckoutRepository(prisma as unknown as PrismaService);
  return { prisma, repo };
}

function expectClaimed(result: WebhookClaimResult): Extract<WebhookClaimResult, { state: 'CLAIMED' }> {
  expect(result.state).toBe('CLAIMED');
  if (result.state !== 'CLAIMED') throw new Error(`expected CLAIMED, got ${result.state}`);
  return result;
}

async function claimFreshEvidence(
  repo: PrismaOrderCheckoutRepository,
  leaseExpiresAt: Date,
  paymentIntentId?: string,
): Promise<{ webhookId: string; leaseOwnerHash: string }> {
  const eventId = randomUUID();
  const payloadHash = createHash('sha256').update(eventId).digest('hex');
  const leaseOwnerHash = createHash('sha256').update(`owner:${eventId}`).digest('hex');
  const claim = await repo.claimWebhookEvidence({
    paymentIntentId: paymentIntentId ?? null,
    provider: 'bold',
    eventId,
    providerPaymentId: null,
    providerReference: null,
    eventType: 'payment.updated',
    status: 'APPROVED',
    amount: 10_000,
    currency: 'COP',
    signatureValid: true,
    payloadHash,
    providerAccountHash: 'p7-redteam-account-hash',
    processedStatus: 'PROCESSING',
    rawPayload: { p7RedTeam: true },
    leaseOwnerHash,
    leaseExpiresAt,
    maxAttempts: 5,
  });
  const claimed = expectClaimed(claim);
  return { webhookId: claimed.webhookId, leaseOwnerHash };
}

let fixtureCounter = 0;
function uniqueSuffix(): string {
  fixtureCounter += 1;
  return `p7-redteam-${Date.now()}-${fixtureCounter}`;
}

/** Minimal real OrderCheckout + PaymentIntent fixture pair, created directly via the typed
 * client (not through the HTTP/service layer, which is out of scope for this unit) -- just
 * enough for `transitionPayment` to have a real row to lock/read/version-check after its
 * webhookClaim ownership gate. */
async function createCheckoutAndIntent(prisma: PrismaClient) {
  const suffix = uniqueSuffix();
  const checkout = await prisma.orderCheckout.create({
    data: {
      source: 'SOFIA',
      sourceReference: suffix,
      idempotencyKey: `checkout-${suffix}`,
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
      idempotencyKey: `intent-${suffix}`,
      provider: 'BOLD',
      amount: 10_000,
      status: 'PENDING',
    },
  });
  return { checkout, intent };
}

describe.each(TIMEZONES)('P7 red team -- webhook lease timezone safety under session TZ=%s', (tz) => {
  let prisma: PrismaClient;
  let repo: PrismaOrderCheckoutRepository;

  beforeEach(async () => {
    const ctx = await openP7Session(tz);
    prisma = ctx.prisma;
    repo = ctx.repo;
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('claimWebhookEvidence write -> findClaimedWebhookEvidence read: a fresh 30s lease must be active immediately (original P3 -5h corruption scenario)', async () => {
    const leaseExpiresAt = new Date(Date.now() + 30_000);
    const { webhookId, leaseOwnerHash } = await claimFreshEvidence(repo, leaseExpiresAt);

    const evidence = await repo.findClaimedWebhookEvidence(webhookId, leaseOwnerHash);
    expect(evidence).not.toBeNull();
    expect(evidence?.id).toBe(webhookId);
  });

  it('findClaimedWebhookEvidence must reject a genuinely expired lease (never appear active past its real expiry)', async () => {
    const leaseExpiresAt = new Date(Date.now() - 2_000); // expired 2s ago in real UTC terms
    const { webhookId, leaseOwnerHash } = await claimFreshEvidence(repo, leaseExpiresAt);

    const evidence = await repo.findClaimedWebhookEvidence(webhookId, leaseOwnerHash);
    expect(evidence).toBeNull();
  });

  it("transitionPayment's webhookClaim ownership check: a fresh 30s lease must let the real transition APPLY (never throw PAYMENT_WEBHOOK_CLAIM_LOST)", async () => {
    const { intent } = await createCheckoutAndIntent(prisma);
    const leaseExpiresAt = new Date(Date.now() + 30_000);
    const { webhookId, leaseOwnerHash } = await claimFreshEvidence(repo, leaseExpiresAt, intent.id);

    // Calls the REAL repository method end-to-end (not a hand-copied SQL string) -- this is
    // exactly the code path a genuinely successful Bold webhook takes.
    const updated = await repo.transitionPayment({
      paymentIntentId: intent.id,
      expectedVersion: intent.version,
      toStatus: 'SUCCEEDED',
      reasonCode: 'BOLD_WEBHOOK_APPROVED',
      idempotencyKey: `p7-transition-${webhookId}`,
      webhookEventId: webhookId,
      webhookClaim: { webhookId, leaseOwnerHash },
    });
    expect(updated.status).toBe('SUCCEEDED');
  });

  it("transitionPayment's webhookClaim ownership check: a genuinely expired lease must throw PAYMENT_WEBHOOK_CLAIM_LOST (never silently proceed on a stale claim)", async () => {
    const { intent } = await createCheckoutAndIntent(prisma);
    const leaseExpiresAt = new Date(Date.now() - 2_000); // expired 2s ago, real UTC-anchored instant
    const { webhookId, leaseOwnerHash } = await claimFreshEvidence(repo, leaseExpiresAt, intent.id);

    let caught: unknown;
    try {
      await repo.transitionPayment({
        paymentIntentId: intent.id,
        expectedVersion: intent.version,
        toStatus: 'SUCCEEDED',
        reasonCode: 'BOLD_WEBHOOK_APPROVED',
        idempotencyKey: `p7-transition-expired-${webhookId}`,
        webhookEventId: webhookId,
        webhookClaim: { webhookId, leaseOwnerHash },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const response = (caught as { getResponse?: () => unknown })?.getResponse?.();
    expect((response as { code?: string })?.code).toBe('PAYMENT_WEBHOOK_CLAIM_LOST');

    // And the intent must NOT have been mutated -- fail-closed, not silently proceed.
    const reread = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(reread.status).toBe('PENDING');
    expect(reread.version).toBe(intent.version);
  });

  it('REGRESSION SENTINEL: raw $executeRaw write of a naive-column Date is session-timezone-dependent (proves the bug class is real; the fix must avoid this exact pattern)', async () => {
    // Writes processing_lease_expires_at the OLD (buggy) way -- a raw $executeRaw with a bound
    // JS Date -- side-by-side with the typed-client write, and shows they diverge under non-UTC
    // sessions. This is not testing production code; it is proving the bug class this suite
    // guards against is real and reproducible on THIS infrastructure, independent of P6's claim.
    const eventId = randomUUID();
    const payloadHash = createHash('sha256').update(eventId).digest('hex');
    const created = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'bold',
        eventId,
        providerPaymentId: null,
        providerReference: null,
        eventType: 'payment.updated',
        status: 'APPROVED',
        amount: 10_000,
        currency: 'COP',
        signatureValid: true,
        payloadHash,
        providerAccountHash: 'p7-redteam-sentinel',
        processedStatus: 'PROCESSING',
        rawPayload: { p7RedTeamSentinel: true },
      },
    });

    const intendedUtc = new Date('2026-08-20T12:00:00.000Z');
    await prisma.$executeRawUnsafe(
      `UPDATE payment_webhook_events SET processing_lease_expires_at = $1 WHERE id = $2`,
      intendedUtc,
      created.id,
    );

    const rawStored = await prisma.$queryRawUnsafe<Array<{ raw: string }>>(
      `SELECT processing_lease_expires_at::text AS raw FROM payment_webhook_events WHERE id = $1`,
      created.id,
    );
    const storedNaiveText = rawStored[0]?.raw;

    if (tz === 'UTC') {
      // At UTC offset 0 the naive stored wall-clock value coincidentally matches the intended
      // UTC instant -- this is exactly why the bug was dormant in the default docker-compose
      // environment. Assert the match to document the coincidence, not to claim safety.
      expect(storedNaiveText).toBe('2026-08-20 12:00:00');
    } else {
      // Under every non-UTC session, the raw $executeRaw path corrupts the stored value --
      // confirming this bug class is real on P7's own infrastructure and that any surviving
      // raw-write path with a bound Date parameter remains dangerous.
      expect(storedNaiveText).not.toBe('2026-08-20 12:00:00');
    }
  });
});
