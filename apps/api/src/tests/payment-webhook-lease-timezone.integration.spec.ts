import { createHash, randomBytes } from 'node:crypto';
import { openTzScopedContext, type TzScopedContext } from './helpers/tz-scoped-client';
import type { WebhookEvidenceInput } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reintegration of the historical PK6 remediation track (inventario-remediation-p4 design, p5
 * fix, p6/p7 timezone-matrix tests), never merged to main -- `payment_webhook_events.
 * processing_lease_expires_at` / `next_retry_at` timezone-safety.
 *
 * Root cause: these columns are naive `TIMESTAMP(3)` ("timestamp without time zone"). A JS
 * `Date` bound into a raw `$executeRaw`/`$queryRaw` template literal is serialized by Prisma's
 * query engine using the Postgres session's `TimeZone` GUC, while the typed Prisma Client
 * (`.update()`, `.updateMany()`, `{ gt: new Date() }` filters, ...) always serializes/compares
 * `DateTime` values UTC-normalized, independent of session `TimeZone`. Mixing raw-SQL writes/
 * compares with typed-client writes/compares on the SAME naive column is session-timezone-
 * dependent and silently dormant under the project's UTC-default docker-compose Postgres.
 *
 * This suite opens genuinely separate PostgreSQL sessions pinned to non-UTC timezones (via the
 * libpq `options=-c timezone=<tz>` startup parameter, verified per-session with `SHOW
 * timezone`) and exercises the real repository methods against them -- never mocked, never
 * simulated in JS.
 */
describe('payment_webhook_events lease/retry timezone safety', () => {
  let app: Awaited<ReturnType<typeof import('./helpers/test-app')['createTestApp']>>['app'];
  let prisma: PrismaService;
  let utc: TzScopedContext;
  let bogota: TzScopedContext;
  let berlin: TzScopedContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Webhook lease timezone tests require an isolated _test database.');
    }
    const { createTestApp } = await import('./helpers/test-app');
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    utc = await openTzScopedContext('UTC');
    bogota = await openTzScopedContext('America/Bogota'); // UTC-5, no DST: reproduces the originally reported corruption.
    berlin = await openTzScopedContext('Europe/Berlin'); // UTC+1/+2: mirror-image direction.
  });

  afterAll(async () => {
    await utc.dispose();
    await bogota.dispose();
    await berlin.dispose();
    const { closeTestApp } = await import('./helpers/test-app');
    await closeTestApp(app);
  });

  beforeEach(async () => {
    const { resetDatabase, seedTestData } = await import('./helpers/test-data');
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  function evidence(overrides: Partial<WebhookEvidenceInput> = {}): WebhookEvidenceInput {
    const id = randomBytes(8).toString('hex');
    return {
      paymentIntentId: null,
      provider: 'BOLD',
      eventId: `evt-${id}`,
      providerPaymentId: null,
      providerReference: null,
      eventType: 'PAYMENT',
      status: 'APPROVED',
      amount: null,
      currency: null,
      signatureValid: true,
      payloadHash: createHash('sha256').update(id).digest('hex'),
      providerAccountHash: null,
      processedStatus: 'PROCESSING',
      rawPayload: { sanitized: true },
      ...overrides,
    };
  }

  async function createPaymentIntentFixture(label: string) {
    const product = await utc.prisma.product.findFirst({ where: { isActive: true } });
    const category = product ? null : await utc.prisma.category.create({ data: { name: 'TZ', slug: `tz-${label}` } });
    const unit = product ? null : await utc.prisma.unit.create({ data: { name: 'Unidad', code: `tz-${label}`, abbreviation: 'u' } });
    const resolvedProduct = product ?? await utc.prisma.product.create({
      data: {
        code: `TZ-${label}`,
        name: 'Combo TZ',
        salePrice: 10_000,
        categoryId: category!.id,
        unitId: unit!.id,
        kind: 'DIRECT_STOCK',
        currentStock: 5,
        trackStock: true,
      },
    });
    const draftHash = `tz-draft-${label}-${Date.now()}`;
    const draft = await utc.prisma.sofiaOrderDraft.create({
      data: {
        status: 'CONFIRMED',
        fulfillment: 'DELIVERY',
        paymentPreference: 'ONLINE',
        version: 1,
        draftHash,
        confirmationHash: `confirm-${draftHash}`,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        customerName: 'Cliente TZ',
        deliveryAddress: 'Carrera de prueba 1',
        itemsSnapshot: [{
          productId: resolvedProduct.id,
          code: resolvedProduct.code,
          name: resolvedProduct.name,
          quantity: 1,
          unitPrice: Number(resolvedProduct.salePrice),
          totalPrice: Number(resolvedProduct.salePrice),
          modifiers: [],
        }],
        subtotal: resolvedProduct.salePrice,
        deliveryFee: 0,
        total: resolvedProduct.salePrice,
      },
    });
    const checkout = await utc.prisma.orderCheckout.create({
      data: {
        source: 'SOFIA',
        sourceReference: draft.id,
        idempotencyKey: `tz-checkout-${label}-${Date.now()}`,
        sofiaDraftId: draft.id,
        sofiaDraftVersion: draft.version,
        itemsSnapshot: draft.itemsSnapshot!,
        subtotal: draft.subtotal,
        total: draft.total,
        fulfillment: draft.fulfillment!,
        paymentPreference: draft.paymentPreference,
        status: 'CONFIRMED',
      },
    });
    return utc.prisma.paymentIntent.create({
      data: {
        checkoutId: checkout.id,
        attemptNumber: 1,
        idempotencyKey: `tz-intent-${label}-${Date.now()}`,
        provider: 'BOLD',
        amount: checkout.total,
        currency: checkout.currency,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 20 * 60_000),
      },
    });
  }

  // --- Probe 1 (P4 design doc): fresh lease claim under a non-UTC session must be visible to a
  // typed-client read (findClaimedWebhookEvidence), exactly as it would be under UTC. Before the
  // fix, a lease claimed under America/Bogota was invisible (NULL) to this check -- the reported
  // symptom (processClaimedWebhook -> PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID -> permanently
  // blocked, even for a genuinely successful payment).
  it.each([
    ['America/Bogota', () => bogota],
    ['Europe/Berlin', () => berlin],
  ])('a fresh 30s lease claimed under a %s session is visible via the typed-client read (findClaimedWebhookEvidence)', async (_tz, getCtx) => {
    const ctx = getCtx();
    const leaseOwnerHash = createHash('sha256').update(`owner-${_tz}`).digest('hex');
    const leaseExpiresAt = new Date(Date.now() + 30_000);
    const claim = await ctx.repo.claimWebhookEvidence({
      ...evidence(),
      leaseOwnerHash,
      leaseExpiresAt,
      maxAttempts: 5,
    });
    expect(claim.state).toBe('CLAIMED');
    if (claim.state !== 'CLAIMED') throw new Error('unreachable');

    // Read back via the UTC-session repository's typed-client comparison -- the exact
    // call findClaimedWebhookEvidence (and CanonicalPaymentWebhookService.processClaimedWebhook)
    // makes. If this is NULL, the lease looks invisible/expired despite being 30 seconds old.
    const found = await utc.repo.findClaimedWebhookEvidence(claim.webhookId, leaseOwnerHash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(claim.webhookId);
  });

  // --- Probes 3-4 (mirror-image direction): a lease written by the typed client (the fix) and
  // genuinely expired 60s ago must correctly read as "not active" / "recoverable" even when the
  // comparing session is non-UTC. Before fixing every raw-SQL compare site (not just the write
  // side), a naive partial fix made expired leases look perpetually active -- a worse, silent
  // failure mode than the originally reported one.
  it.each([
    ['America/Bogota', () => bogota],
    ['Europe/Berlin', () => berlin],
  ])('a genuinely-expired (60s ago) lease is correctly recoverable under a %s session (claimRecoverableWebhook)', async (_tz, getCtx) => {
    const ctx = getCtx();
    const intent = await createPaymentIntentFixture(`recoverable-${_tz}`);
    const leaseOwnerHash = createHash('sha256').update(`owner-recoverable-${_tz}`).digest('hex');
    const firstClaim = await utc.repo.claimWebhookEvidence({
      ...evidence({ paymentIntentId: intent.id }),
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      maxAttempts: 5,
    });
    if (firstClaim.state !== 'CLAIMED') throw new Error('unreachable');

    // Force the lease into the past via the typed client (CANONICAL_TEMPORAL_AUTHORITY), from
    // the UTC session, simulating a lease that genuinely expired 60 seconds ago.
    await utc.prisma.paymentWebhookEvent.update({
      where: { id: firstClaim.webhookId },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    const recoverableIds = await ctx.repo.findRecoverableWebhookIds(new Date(), 50, 5);
    expect(recoverableIds).toContain(firstClaim.webhookId);

    const reclaimed = await ctx.repo.claimRecoverableWebhook({
      webhookId: firstClaim.webhookId,
      leaseOwnerHash: createHash('sha256').update(`owner-recoverable-2-${_tz}`).digest('hex'),
      leaseExpiresAt: new Date(Date.now() + 30_000),
      maxAttempts: 5,
    });
    expect(reclaimed.state).toBe('CLAIMED');
  });

  // --- advanceWebhookCheckpoint / completeWebhookClaim / assertWebhookClaimOwned /
  // renewWebhookClaim / failWebhookClaim: each compares processing_lease_expires_at against
  // "now" (CURRENT_TIMESTAMP or `{ gt: new Date() }`). A lease written by the typed client and
  // still fresh must be usable by the SAME owner from a non-UTC session.
  it.each([
    ['America/Bogota', () => bogota],
    ['Europe/Berlin', () => berlin],
  ])('a fresh lease claimed under UTC is usable end-to-end (advance/complete/renew/assert) from a %s session', async (_tz, getCtx) => {
    const ctx = getCtx();
    const leaseOwnerHash = createHash('sha256').update(`owner-e2e-${_tz}`).digest('hex');
    const claim = await utc.repo.claimWebhookEvidence({
      ...evidence(),
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      maxAttempts: 5,
    });
    if (claim.state !== 'CLAIMED') throw new Error('unreachable');

    await expect(ctx.repo.assertWebhookClaimOwned(claim.webhookId, leaseOwnerHash)).resolves.toBeUndefined();
    await expect(ctx.repo.advanceWebhookCheckpoint({
      webhookId: claim.webhookId,
      leaseOwnerHash,
      checkpoint: 'VALIDATED',
    })).resolves.toBeUndefined();

    const renewedAt = await ctx.repo.renewWebhookClaim(claim.webhookId, leaseOwnerHash);
    expect(renewedAt.getTime()).toBeGreaterThan(Date.now());

    await expect(ctx.repo.completeWebhookClaim({
      webhookId: claim.webhookId,
      leaseOwnerHash,
      result: { processedStatus: 'PROCESSED', paymentIntentId: null, paymentStatus: null },
    })).resolves.toBeUndefined();
  });

  // --- failWebhookClaim: genuinely-owned, fresh lease must be fail-able from a non-UTC session,
  // and the resulting retryable/next_retry_at bookkeeping must be correct.
  it.each([
    ['America/Bogota', () => bogota],
    ['Europe/Berlin', () => berlin],
  ])('failWebhookClaim correctly marks a fresh, owned lease as retryable-FAILED from a %s session', async (_tz, getCtx) => {
    const ctx = getCtx();
    const leaseOwnerHash = createHash('sha256').update(`owner-fail-${_tz}`).digest('hex');
    const claim = await utc.repo.claimWebhookEvidence({
      ...evidence(),
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      maxAttempts: 5,
    });
    if (claim.state !== 'CLAIMED') throw new Error('unreachable');

    await ctx.repo.failWebhookClaim({
      webhookId: claim.webhookId,
      leaseOwnerHash,
      errorCode: 'DOWNSTREAM_TIMEOUT',
      maxAttempts: 5,
      retryable: true,
    });

    const row = await utc.prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: claim.webhookId } });
    expect(row.processedStatus).toBe('FAILED');
    expect(row.retryable).toBe(true);
    expect(row.processedAt).toBeNull();
  });

  // --- transitionPayment's webhookClaim ownership check (P6-discovered second instance of the
  // same bug class): this one keeps a raw SELECT ... FOR UPDATE (it needs the row lock, which
  // has no typed-client equivalent), so it must use an explicit AT TIME ZONE 'UTC' cast instead
  // of comparing the naive column directly against CURRENT_TIMESTAMP. Without the cast, a
  // genuinely (legitimately) expired lease appears still active under a non-UTC session,
  // letting transitionPayment proceed on a stale/reclaimable claim instead of raising
  // PAYMENT_WEBHOOK_CLAIM_LOST.
  it.each([
    ['America/Bogota', () => bogota],
    ['Europe/Berlin', () => berlin],
  ])('transitionPayment correctly rejects a genuinely-expired webhookClaim ownership check from a %s session', async (_tz, getCtx) => {
    const ctx = getCtx();
    const leaseOwnerHash = createHash('sha256').update(`owner-transition-${_tz}`).digest('hex');
    const claim = await utc.repo.claimWebhookEvidence({
      ...evidence(),
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      maxAttempts: 5,
    });
    if (claim.state !== 'CLAIMED') throw new Error('unreachable');
    // Expire it via the typed client (CANONICAL_TEMPORAL_AUTHORITY write path).
    await utc.prisma.paymentWebhookEvent.update({
      where: { id: claim.webhookId },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const intent = await createPaymentIntentFixture(`transition-${_tz}`);

    await expect(ctx.repo.transitionPayment({
      paymentIntentId: intent.id,
      expectedVersion: intent.version,
      toStatus: 'SUCCEEDED',
      reasonCode: 'TEST_TZ_TRANSITION',
      idempotencyKey: `tz-transition-${_tz}-${Date.now()}`,
      webhookClaim: { webhookId: claim.webhookId, leaseOwnerHash },
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_WEBHOOK_CLAIM_LOST' }) });
  });
});
