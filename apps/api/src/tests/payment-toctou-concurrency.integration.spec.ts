import type { INestApplication } from '@nestjs/common';
import {
  OrderTicketType,
  PaymentIntentProvider,
  PaymentIntentStatus,
  Prisma,
  ProductKind,
  SofiaPaymentPreference,
} from '@prisma/client';
import { createHmac } from 'node:crypto';
import { CanonicalPaymentWebhookService } from '../modules/order-checkout/canonical-payment-webhook.service';
import { OrderCheckoutService } from '../modules/order-checkout/order-checkout.service';
import { PaymentOrchestrationService } from '../modules/order-checkout/payment-orchestration.service';
import { Phase5RuntimeGate } from '../modules/order-checkout/phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import { isRetryableTransactionError } from '../modules/order-checkout/transaction-retry';
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

/**
 * Reintegration of the PK5 remediation track (historical worktrees
 * inventario-remediation-p0/p1/p2/p3, never merged to main) -- PostgreSQL concurrency tests.
 *
 * Empirically proves, against real Postgres with genuinely parallel connections (never mocked),
 * that moving the relink/active-attempt check inside the `FOR UPDATE` + `Serializable`
 * transaction (against a freshly locked re-read) closes the reproduced TOCTOU race: two
 * concurrent `createOnlinePaymentLink` calls for the same checkout with DIFFERENT
 * idempotencyKeys must never both succeed.
 *
 * Every scenario below asserts the invariant directly against the database:
 * ACTIVE_INTENTS_PER_CHECKOUT (PaymentIntent rows in CREATED/LINK_READY/PENDING per checkoutId)
 * must never exceed 1. This is enforced globally in `afterEach` in addition to scenario-local
 * assertions.
 *
 * Adapted from the historical p2 suite for current main's architecture: main never merged the
 * PK4 PaymentExpirationWorker feature these tests originally depended on for the expiry
 * scenarios, so "expired intent" scenarios here manipulate PaymentIntent.expiresAt directly and
 * rely on the relink policy's own synchronous lazy-expiry check (no durable status flip via a
 * worker sweep is needed for relink to be allowed).
 */
describe('SOFIA payment TOCTOU remediation -- PostgreSQL concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaOrderCheckoutRepository;
  let checkouts: OrderCheckoutService;
  let payments: PaymentOrchestrationService;
  let webhooks: CanonicalPaymentWebhookService;
  let bold: BoldPaymentProvider;
  let actorId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('TOCTOU concurrency tests require an isolated _test database.');
    }
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.BOLD_API_KEY = 'toctou-test-key';
    process.env.BOLD_WEBHOOK_SECRET = 'toctou-test-webhook-secret';
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(PrismaOrderCheckoutRepository);
    app.get(Phase5RuntimeGate);
    checkouts = app.get(OrderCheckoutService);
    payments = app.get(PaymentOrchestrationService);
    webhooks = app.get(CanonicalPaymentWebhookService);
    bold = app.get(BoldPaymentProvider);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    actorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } })).id;
    await prisma.cashSession.create({ data: { openedById: actorId, openingAmount: 0 } });
  });

  // Global, scenario-independent invariant: no checkout may ever have more than one *chargeable*
  // PaymentIntent at the same time. Checked directly against the database after every single
  // test in this file, regardless of what the test itself asserted.
  //
  // "Chargeable" is NOT simply "non-terminal status column":
  //   - CREATED/LINK_READY never issued a live provider checkout URL, so once their own
  //     `expiresAt` has elapsed they are financially inert even though this codebase has no
  //     PaymentExpirationWorker (that PK4 feature was never merged to main) to durably sweep
  //     them to EXPIRED -- their PaymentLink's own expiresAt has also elapsed, so
  //     resolvePaymentLink/startBoldPayment can never charge them again.
  //   - PENDING is different and must NEVER be excluded by its own `expiresAt`: it is reached
  //     only after Bold already issued a live checkoutUrl (beginProviderPayment +
  //     BoldPaymentProvider.createPayment), and nothing in this codebase ever revokes that
  //     provider-side link. A PENDING row is chargeable for as long as it stays PENDING,
  //     regardless of our own local TTL -- this is exactly the scenario the ALTO-1 fix in
  //     PaymentOrchestrationService.assertRelinkAllowed exists to guard (a PENDING intent must
  //     never be treated as "lazily expired -> safe to relink"). Excluding PENDING by `expiresAt`
  //     here would make this very oracle blind to a PAYMENT_ATTEMPT_ACTIVE/PAYMENT_RELINK_BLOCKED
  //     regression on PENDING.
  //
  // Uses the typed Prisma Client exclusively (no raw `NOW()`/`$queryRaw`): PaymentIntent.
  // expiresAt is written exclusively via the typed client (see payment-orchestration.service.ts/
  // prisma-order-checkout.repository.ts), and comparing it via raw SQL `NOW()` is exactly the
  // CANONICAL_TEMPORAL_AUTHORITY mismatch class this remediation closed for payment_webhook_events
  // -- this test oracle must not reintroduce it for PaymentIntent.
  async function chargeableIntentViolations() {
    const now = new Date();
    const rows = await prisma.paymentIntent.groupBy({
      by: ['checkoutId'],
      where: {
        OR: [
          {
            status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.LINK_READY] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          { status: PaymentIntentStatus.PENDING },
        ],
      },
      _count: { _all: true },
    });
    return rows.filter((row) => row._count._all > 1);
  }

  afterEach(async () => {
    expect(await chargeableIntentViolations()).toEqual([]);
  });

  async function onlineCheckout(label: string) {
    const product = await prisma.product.findFirst({ where: { isActive: true } })
      ?? await (async () => {
        const category = await prisma.category.findFirst() ?? await prisma.category.create({ data: { name: 'TOCTOU', slug: `toctou-${label}` } });
        const unit = await prisma.unit.findFirst() ?? await prisma.unit.create({ data: { name: 'Unidad', code: `toctou-${label}`, abbreviation: 'u' } });
        return prisma.product.create({
          data: {
            code: `TOCTOU-${label}`,
            name: 'Combo TOCTOU',
            salePrice: 25_000,
            categoryId: category.id,
            unitId: unit.id,
            kind: ProductKind.DIRECT_STOCK,
            currentStock: 20,
            trackStock: true,
          },
        });
      })();
    const draftHash = `toctou-draft-${label}`;
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        status: 'CONFIRMED',
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.ONLINE,
        version: 1,
        draftHash,
        confirmationHash: `confirm-${draftHash}`,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        customerName: 'Cliente TOCTOU',
        deliveryAddress: 'Carrera de prueba 1',
        itemsSnapshot: [{
          productId: product.id,
          code: product.code,
          name: product.name,
          quantity: 1,
          unitPrice: Number(product.salePrice),
          totalPrice: Number(product.salePrice),
          modifiers: [],
        }],
        subtotal: product.salePrice,
        deliveryFee: 5_000,
        total: Number(product.salePrice) + 5_000,
      },
    });
    return checkouts.createFromConfirmedSofiaDraft({
      draftId: draft.id,
      expectedDraftVersion: draft.version,
      expectedDraftHash: draftHash,
      confirmationHash: draft.confirmationHash!,
      idempotencyKey: `toctou-checkout-${label}`,
      actorId,
    });
  }

  function boldSignature(rawBody: Buffer) {
    return createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET!).update(rawBody.toString('base64')).digest('hex');
  }

  // Mirrors chargeableIntentViolations' definition of "chargeable" above: PENDING always counts
  // regardless of its own expiresAt; CREATED/LINK_READY only count while not lazily expired.
  async function activeIntentCount(checkoutId: string) {
    const now = new Date();
    return prisma.paymentIntent.count({
      where: {
        checkoutId,
        OR: [
          {
            status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.LINK_READY] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          { status: PaymentIntentStatus.PENDING },
        ],
      },
    });
  }

  // --- Scenario: 2 concurrent callers, same checkout, same idempotencyKey -----------------------
  it('2 concurrent callers, same checkout, SAME idempotencyKey: both resolve to the exact same PaymentIntent', async () => {
    const checkout = await onlineCheckout('same-key');
    const key = 'toctou-same-key-shared';
    const results = await Promise.all([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: key, actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: key, actorId }),
    ]);
    expect(results[0].paymentIntent.id).toBe(results[1].paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: 2 concurrent callers, DIFFERENT idempotencyKeys (the exact reported PoC) -------
  it('PoC: 2 concurrent callers, same checkout, DIFFERENT idempotencyKeys: exactly one PaymentIntent is created', async () => {
    const checkout = await onlineCheckout('diff-key-2');
    const results = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-diff-key-2-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-diff-key-2-b', actorId }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }),
    });
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: 10 concurrent callers, all different keys --------------------------------------
  it('10 concurrent callers, all different keys, same checkout: exactly one PaymentIntent survives', async () => {
    const checkout = await onlineCheckout('diff-key-10');
    const attempts = Array.from({ length: 10 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `toctou-diff-key-10-${index}`, actorId }));
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const failure of rejected as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({
        response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }),
      });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: serialization failure + automatic retry does not create a duplicate ------------
  it('serialization failure triggers automatic retry (real Postgres 40001/P2034) without creating a duplicate PaymentIntent', async () => {
    const checkout = await onlineCheckout('retry-no-dup');
    const createSpy = jest.spyOn(repository, 'createPaymentIntent');
    const results = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-retry-no-dup-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-retry-no-dup-b', actorId }),
    ]);
    // The retried unit is repository.createPaymentIntent itself (a fresh $transaction per call).
    // Exactly 2 logical requests were issued; strictly more than 2 underlying invocations proves
    // withBoundedTransactionRetry actually retried at least one of them after a real Postgres
    // serialization failure (40001/P2034) or lock-wait-then-conflict -- not just 2 first attempts
    // -- and despite that extra attempt, exactly one PaymentIntent must exist.
    expect(createSpy.mock.calls.length).toBeGreaterThan(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  it('directly verifies isRetryableTransactionError classifies real Postgres serialization failures (40001/P2034) as retryable, never a business rejection', async () => {
    const serializationFailure = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      { code: 'P2034', clientVersion: '6.19.2' },
    );
    expect(isRetryableTransactionError(serializationFailure)).toBe(true);

    const rawSerializationFailure = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`',
      { code: 'P2010', clientVersion: '6.19.2', meta: { code: '40001', message: 'could not serialize access due to concurrent update' } },
    );
    expect(isRetryableTransactionError(rawSerializationFailure)).toBe(true);

    // A genuine business rejection (ConflictException via checkoutConflict) must never be
    // misclassified as a retryable database error.
    expect(isRetryableTransactionError(new Error('PAYMENT_ATTEMPT_ACTIVE'))).toBe(false);
  });

  // --- Scenario: crash before commit -- transaction abort leaves no dangling PaymentIntent -------
  it('crash before commit (transaction abort): no PaymentIntent is left behind and the checkout is unaffected', async () => {
    const checkout = await onlineCheckout('crash-before-commit');
    class SimulatedProcessCrash extends Error {}

    await expect(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${checkout.id} FOR UPDATE`;
      await tx.paymentIntent.create({
        data: {
          checkoutId: checkout.id,
          attemptNumber: 1,
          idempotencyKey: 'toctou-crash-before-commit-doomed',
          provider: PaymentIntentProvider.BOLD,
          amount: checkout.total,
          currency: checkout.currency,
          status: PaymentIntentStatus.CREATED,
          expiresAt: new Date(Date.now() + 20 * 60_000),
        },
      });
      throw new SimulatedProcessCrash('simulated crash before commit');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow(SimulatedProcessCrash);

    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(0);
    const untouchedCheckout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(untouchedCheckout.version).toBe(1);
    expect(untouchedCheckout.status).toBe('CONFIRMED');

    // A real subsequent call proceeds normally, completely unaffected by the aborted attempt.
    const recovered = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-crash-before-commit-recovery',
      actorId,
    });
    expect(recovered.paymentIntent.attemptNumber).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: crash immediately after commit ---------------------------------------------------
  it('crash immediately after commit: subsequent calls see exactly one active PaymentIntent, no duplicate is possible', async () => {
    const checkout = await onlineCheckout('crash-after-commit');
    const first = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-crash-after-commit-a',
      actorId,
    });
    // The transaction has already committed durably (this is what "crash immediately after
    // commit" means: the process may die here, but Postgres already has the row). Any subsequent
    // caller -- concurrent or sequential, real process restart or not -- must observe exactly the
    // one committed PaymentIntent and be blocked from creating a second one.
    const followUps = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-crash-after-commit-b', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-crash-after-commit-c', actorId }),
    ]);
    expect(followUps.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of followUps as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
    const survivor = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: first.paymentIntent.id } });
    expect(survivor.id).toBe(first.paymentIntent.id);
  });

  // --- Scenario: existing UNKNOWN_RESULT intent -> relink still correctly blocked, even under concurrency ---
  it('existing UNKNOWN_RESULT intent: concurrent relink attempts are all blocked, never bypassed by the race window', async () => {
    const checkout = await onlineCheckout('unknown-result-block');
    const prepared = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-unknown-result-block-1',
      actorId,
    });
    jest.spyOn(bold, 'createPayment').mockRejectedValueOnce(new Error('network timeout'));
    const token = prepared.publicPath!.split('/').pop()!;
    await expect(payments.startBoldPayment(token)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intent.status).toBe(PaymentIntentStatus.UNKNOWN_RESULT);

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `toctou-unknown-result-block-relink-${index}`, actorId })));
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of attempts as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_RELINK_BLOCKED' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  // --- ALTO-1 regression (independent reviewer finding on af4fb9c): a PENDING intent -- one that
  // already has a live, provider-issued Bold checkoutUrl in the client's hands (beginProviderPayment
  // + BoldPaymentProvider.createPayment already ran) -- must NEVER be treated as "lazily expired,
  // therefore safe to relink" just because our own local TTL elapsed. Nothing in this codebase ever
  // calls revokePaymentLink, so an elapsed local TTL does not mean the Bold-side checkout is dead; a
  // second, independently chargeable link for the same checkout would violate CLAUDE.md Sec.15 ("no
  // duplicate charge"). The only acceptable outcome once a PENDING attempt's own TTL has elapsed is
  // PAYMENT_RELINK_BLOCKED (human reconciliation), never a fresh attemptNumber.
  it('ALTO-1: a PENDING intent whose own TTL has elapsed is permanently blocked (PAYMENT_RELINK_BLOCKED), never automatically relinked', async () => {
    const checkout = await onlineCheckout('pending-ttl-elapsed-block');
    const prepared = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-pending-ttl-elapsed-1',
      actorId,
    });
    jest.spyOn(bold, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-pending-ttl-elapsed',
      providerReference: `checkout_${prepared.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    const token = prepared.publicPath!.split('/').pop()!;
    await payments.startBoldPayment(token);
    const pending = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(pending.status).toBe(PaymentIntentStatus.PENDING);

    // No webhook ever arrives; simulate the local TTL elapsing while Bold's own checkoutUrl may
    // still be genuinely live and payable.
    await prisma.paymentIntent.update({ where: { id: pending.id }, data: { expiresAt: new Date(0) } });

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `toctou-pending-ttl-elapsed-relink-${index}`, actorId })));
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of attempts as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_RELINK_BLOCKED' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  // --- ALTO-2 regression (independent reviewer finding on af4fb9c): the relink policy must
  // evaluate EVERY PaymentIntent on the checkout, not just the most recent one by attemptNumber.
  // Reproduces the reviewer's exact scenario: attempt 1 is still active (LINK_READY, own TTL in
  // the future) while attempt 2 -- the most recent by attemptNumber -- is terminal (FAILED). A
  // policy that only inspects paymentIntents[0] would see attempt 2's FAILED status, conclude
  // relink is allowed, and create attempt 3 -- leaving attempt 1 and attempt 3 simultaneously
  // chargeable. Attempt 1/2 are inserted directly (bypassing the service) to construct this state
  // deterministically, mirroring how the independent reviewer verified it.
  it('ALTO-2: an older still-active intent blocks a new attempt even when the most recent attempt is terminal', async () => {
    const checkout = await onlineCheckout('older-active-blocks-new');
    await prisma.orderCheckout.update({ where: { id: checkout.id }, data: { status: 'PAYMENT_PENDING' } });
    const attempt1 = await prisma.paymentIntent.create({
      data: {
        checkoutId: checkout.id,
        attemptNumber: 1,
        idempotencyKey: 'toctou-older-active-blocks-new-1',
        provider: PaymentIntentProvider.BOLD,
        amount: checkout.total,
        currency: checkout.currency,
        status: PaymentIntentStatus.LINK_READY,
        expiresAt: new Date(Date.now() + 20 * 60_000),
      },
    });
    await prisma.paymentIntent.create({
      data: {
        checkoutId: checkout.id,
        attemptNumber: 2,
        idempotencyKey: 'toctou-older-active-blocks-new-2',
        provider: PaymentIntentProvider.BOLD,
        amount: checkout.total,
        currency: checkout.currency,
        status: PaymentIntentStatus.FAILED,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 20 * 60_000),
      },
    });

    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-older-active-blocks-new-3',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }) });

    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(2);
    const survivor = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: attempt1.id } });
    expect(survivor.status).toBe(PaymentIntentStatus.LINK_READY);
  });

  // --- Scenario: existing SUCCEEDED intent -> relink correctly blocked --------------------------
  it('existing SUCCEEDED intent: concurrent relink attempts are all blocked, checkout already KITCHEN_ELIGIBLE', async () => {
    const checkout = await onlineCheckout('succeeded-block');
    const prepared = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-succeeded-block-1',
      actorId,
    });
    jest.spyOn(bold, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-succeeded-block',
      providerReference: `checkout_${prepared.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    const token = prepared.publicPath!.split('/').pop()!;
    await payments.startBoldPayment(token);
    const payload = {
      id: 'evt-succeeded-block',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-succeeded-block',
        reference: `checkout_${prepared.paymentIntent.id}`,
        metadata: { reference: `checkout_${prepared.paymentIntent.id}` },
        amount: { total: Number(checkout.total), currency: 'COP' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    await webhooks.processBold({
      rawPayload: payload,
      rawBody,
      headers: { 'x-bold-signature': boldSignature(rawBody), 'x-bold-merchant-id': 'merchant-1' },
    });
    const afterFirst = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    // Current main's canonical webhook path moves a successfully-paid checkout to
    // PAYMENT_VERIFIED and then (via KitchenEligibilityService.continueAfterVerifiedPayment)
    // to KITCHEN_ELIGIBLE; ORDER_CREATED requires a separate, explicit SOFIA command that is out
    // of scope here. Either way, KITCHEN_ELIGIBLE is not in the relink policy's payable set
    // (CONFIRMED/PAYMENT_PENDING), so the assertion below (CHECKOUT_NOT_PAYABLE) holds regardless.
    expect(afterFirst.status).toBe('KITCHEN_ELIGIBLE');

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `toctou-succeeded-block-relink-${index}`, actorId })));
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of attempts as PromiseRejectedResult[]) {
      // Checkout is already KITCHEN_ELIGIBLE (not CONFIRMED/PAYMENT_PENDING), so the status
      // guard fires first.
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_NOT_PAYABLE' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  // --- Scenario: lazily-expired intent -> relink correctly allowed ------------------------------
  it('a lazily-expired active intent (expiresAt elapsed, status not yet swept) still allows exactly one of several concurrent relinks to win', async () => {
    const checkout = await onlineCheckout('expired-relink');
    const first = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-expired-relink-1',
      actorId,
    });
    // No PaymentExpirationWorker on this branch of main: the relink policy's own synchronous
    // lazy-expiry check (latest attempt is still CREATED/LINK_READY/PENDING but its own
    // expiresAt has already elapsed) is what must allow this, not a durable status flip.
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `toctou-expired-relink-2-${index}`, actorId })));
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const failure of rejected as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }) });
    }
    const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof payments.createOnlinePaymentLink>>>).value;
    expect(winner.paymentIntent.attemptNumber).toBe(2);
    expect(winner.paymentIntent.id).not.toBe(first.paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(2);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: relink attempt, generally (sequential happy path) ------------------------------
  it('relink happy path (sequential): a fresh attempt after lazy expiry succeeds and produces attemptNumber 2', async () => {
    const checkout = await onlineCheckout('relink-happy-path');
    const first = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-relink-happy-path-1',
      actorId,
    });
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const second = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'toctou-relink-happy-path-2',
      actorId,
    });
    expect(second.paymentIntent.attemptNumber).toBe(2);
    expect(second.paymentIntent.id).not.toBe(first.paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(2);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: duplicate webhook arriving after the race scenario -----------------------------
  it('duplicate webhook after the race: successfulPaymentCount/markFinancialReview backstop still converges to exactly one SUCCEEDED transition', async () => {
    const checkout = await onlineCheckout('dup-webhook-after-race');
    const raced = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-dup-webhook-race-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'toctou-dup-webhook-race-b', actorId }),
    ]);
    const winner = (raced.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof payments.createOnlinePaymentLink>>
    >).value;
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);

    jest.spyOn(bold, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-dup-webhook-after-race',
      providerReference: `checkout_${winner.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    const token = winner.publicPath!.split('/').pop()!;
    await payments.startBoldPayment(token);

    const payload = {
      id: 'evt-dup-webhook-after-race',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-dup-webhook-after-race',
        reference: `checkout_${winner.paymentIntent.id}`,
        metadata: { reference: `checkout_${winner.paymentIntent.id}` },
        amount: { total: Number(checkout.total), currency: 'COP' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const headers = { 'x-bold-signature': boldSignature(rawBody), 'x-bold-merchant-id': 'merchant-1' };

    const firstResult = await webhooks.processBold({ rawPayload: payload, rawBody, headers });
    const secondResult = await webhooks.processBold({ rawPayload: payload, rawBody, headers });
    expect([firstResult.paymentStatus, secondResult.paymentStatus]).toEqual([
      PaymentIntentStatus.SUCCEEDED,
      PaymentIntentStatus.SUCCEEDED,
    ]);
    expect(secondResult.processedStatus === 'DUPLICATE_REPLAY' || secondResult.processedStatus === 'PROCESSED').toBe(true);

    expect(await prisma.paymentWebhookEvent.count({ where: { provider: 'BOLD', eventId: 'evt-dup-webhook-after-race' } })).toBe(1);
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: winner.paymentIntent.id, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(1);
    const afterDup = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    // See the "existing SUCCEEDED intent" scenario above: current main's canonical webhook path
    // reaches KITCHEN_ELIGIBLE (ORDER_CREATED is a separate, out-of-scope SOFIA command). What
    // this scenario actually proves is unaffected by that: the duplicate webhook delivery
    // converges to exactly one SUCCEEDED transition and never trips the financial-review backstop.
    expect(afterDup.status).toBe('KITCHEN_ELIGIBLE');
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id, status: PaymentIntentStatus.SUCCEEDED } })).toBe(1);
    expect(afterDup.status).not.toBe('FINANCIAL_REVIEW_REQUIRED');
  });
});
