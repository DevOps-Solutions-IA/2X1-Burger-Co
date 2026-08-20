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
import { PaymentExpirationWorker } from '../modules/order-checkout/payment-expiration.worker';
import { PaymentOrchestrationService } from '../modules/order-checkout/payment-orchestration.service';
import { Phase5RuntimeGate } from '../modules/order-checkout/phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import { isRetryableTransactionError } from '../modules/order-checkout/transaction-retry';
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

/**
 * P2 (SOFIA Payment TOCTOU remediation) -- PostgreSQL concurrency tests.
 *
 * Empirically proves, against real Postgres with genuinely parallel connections (never mocked),
 * that P1's fix (commit c65aa7e -- moving the relink/active-attempt check inside the
 * `FOR UPDATE` + `Serializable` transaction, against a freshly locked re-read) closes PK5's
 * reproduced TOCTOU race: two concurrent `createOnlinePaymentLink` calls for the same checkout
 * with DIFFERENT idempotencyKeys must never both succeed.
 *
 * Every scenario below asserts the invariant directly against the database:
 * ACTIVE_INTENTS_PER_CHECKOUT (PaymentIntent rows in CREATED/LINK_READY/PENDING per checkoutId)
 * must never exceed 1. This is enforced globally in `afterEach` in addition to scenario-local
 * assertions.
 */
describe('SOFIA payment TOCTOU remediation -- PostgreSQL concurrency (P2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaOrderCheckoutRepository;
  let gate: Phase5RuntimeGate;
  let checkouts: OrderCheckoutService;
  let payments: PaymentOrchestrationService;
  let webhooks: CanonicalPaymentWebhookService;
  let bold: BoldPaymentProvider;
  let worker: PaymentExpirationWorker;
  let actorId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('P2 TOCTOU concurrency tests require an isolated _test database.');
    }
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.BOLD_API_KEY = 'p2-toctou-test-key';
    process.env.BOLD_WEBHOOK_SECRET = 'p2-toctou-test-webhook-secret';
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(PrismaOrderCheckoutRepository);
    gate = app.get(Phase5RuntimeGate);
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
    worker = new PaymentExpirationWorker(repository, gate);
  });

  // Global, scenario-independent invariant: no checkout may ever have more than one PaymentIntent
  // in a non-terminal (active) status at the same time. Checked directly against the database
  // after every single test in this file, regardless of what the test itself asserted.
  afterEach(async () => {
    const violations = await prisma.$queryRaw<Array<{ checkout_id: string; active_count: bigint }>>`
      SELECT checkout_id, COUNT(*) AS active_count
      FROM payment_intents
      WHERE status IN ('CREATED', 'LINK_READY', 'PENDING')
      GROUP BY checkout_id
      HAVING COUNT(*) > 1
    `;
    expect(violations).toEqual([]);
  });

  async function onlineCheckout(label: string) {
    const product = await prisma.product.findFirst({ where: { isActive: true } })
      ?? await (async () => {
        const category = await prisma.category.findFirst() ?? await prisma.category.create({ data: { name: 'P2 TOCTOU', slug: `p2-toctou-${label}` } });
        const unit = await prisma.unit.findFirst() ?? await prisma.unit.create({ data: { name: 'Unidad', code: `p2-${label}`, abbreviation: 'u' } });
        return prisma.product.create({
          data: {
            code: `P2-${label}`,
            name: 'Combo P2 TOCTOU',
            salePrice: 25_000,
            categoryId: category.id,
            unitId: unit.id,
            kind: ProductKind.DIRECT_STOCK,
            currentStock: 20,
            trackStock: true,
          },
        });
      })();
    const draftHash = `p2-draft-${label}`;
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
        customerName: 'Cliente P2 TOCTOU',
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
      idempotencyKey: `p2-checkout-${label}`,
      actorId,
    });
  }

  function boldSignature(rawBody: Buffer) {
    return createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET!).update(rawBody.toString('base64')).digest('hex');
  }

  async function activeIntentCount(checkoutId: string) {
    return prisma.paymentIntent.count({
      where: {
        checkoutId,
        status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.LINK_READY, PaymentIntentStatus.PENDING] },
      },
    });
  }

  // --- Scenario: 2 concurrent callers, same checkout, same idempotencyKey -----------------------
  it('2 concurrent callers, same checkout, SAME idempotencyKey: both resolve to the exact same PaymentIntent', async () => {
    const checkout = await onlineCheckout('same-key');
    const key = 'p2-same-key-shared';
    const results = await Promise.all([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: key, actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: key, actorId }),
    ]);
    expect(results[0].paymentIntent.id).toBe(results[1].paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: 2 concurrent callers, DIFFERENT idempotencyKeys (the exact PK5 PoC) ------------
  it('PK5 PoC: 2 concurrent callers, same checkout, DIFFERENT idempotencyKeys: exactly one PaymentIntent is created', async () => {
    const checkout = await onlineCheckout('diff-key-2');
    const results = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-diff-key-2-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-diff-key-2-b', actorId }),
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
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `p2-diff-key-10-${index}`, actorId }));
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
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-retry-no-dup-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-retry-no-dup-b', actorId }),
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
          idempotencyKey: 'p2-crash-before-commit-doomed',
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
      idempotencyKey: 'p2-crash-before-commit-recovery',
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
      idempotencyKey: 'p2-crash-after-commit-a',
      actorId,
    });
    // The transaction has already committed durably (this is what "crash immediately after
    // commit" means: the process may die here, but Postgres already has the row). Any subsequent
    // caller -- concurrent or sequential, real process restart or not -- must observe exactly the
    // one committed PaymentIntent and be blocked from creating a second one.
    const followUps = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-crash-after-commit-b', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-crash-after-commit-c', actorId }),
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
      idempotencyKey: 'p2-unknown-result-block-1',
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
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `p2-unknown-result-block-relink-${index}`, actorId })));
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of attempts as PromiseRejectedResult[]) {
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_RELINK_BLOCKED' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    // UNKNOWN_RESULT is not "active" by this test's activeIntentCount definition (it requires
    // human reconciliation, not a retry loop), so the global invariant is naturally satisfied; the
    // explicit assertions above are what proves the block actually held under concurrency.
  });

  // --- Scenario: existing SUCCEEDED intent -> relink correctly blocked --------------------------
  it('existing SUCCEEDED intent: concurrent relink attempts are all blocked, checkout already ORDER_CREATED', async () => {
    const checkout = await onlineCheckout('succeeded-block');
    const prepared = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'p2-succeeded-block-1',
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
    expect(afterFirst.status).toBe('ORDER_CREATED');

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `p2-succeeded-block-relink-${index}`, actorId })));
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    for (const failure of attempts as PromiseRejectedResult[]) {
      // Checkout is already ORDER_CREATED (not CONFIRMED/PAYMENT_PENDING), so the status guard
      // fires first -- matches the pre-existing Wave 2B precedent in phase7-payment-expiration.
      expect(failure.reason).toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_NOT_PAYABLE' }) });
    }
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: checkout.id } } })).toBe(1);
  });

  // --- Scenario: expired intent -> relink correctly allowed, re-verifying CAN_EXPIRED_LINK_CREATE_NEW_LINK ---
  it('CAN_EXPIRED_LINK_CREATE_NEW_LINK still holds under P1\'s fix: exactly one of several concurrent relinks wins after expiry', async () => {
    const checkout = await onlineCheckout('expired-relink');
    const first = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'p2-expired-relink-1',
      actorId,
    });
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    await worker.runOnce();
    const expired = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: first.paymentIntent.id } });
    expect(expired.status).toBe(PaymentIntentStatus.EXPIRED);

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: `p2-expired-relink-2-${index}`, actorId })));
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
  it('relink happy path (sequential): a fresh attempt after expiry succeeds and produces attemptNumber 2', async () => {
    const checkout = await onlineCheckout('relink-happy-path');
    const first = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'p2-relink-happy-path-1',
      actorId,
    });
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    await worker.runOnce();

    const second = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'p2-relink-happy-path-2',
      actorId,
    });
    expect(second.paymentIntent.attemptNumber).toBe(2);
    expect(second.paymentIntent.id).not.toBe(first.paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(2);
    expect(await activeIntentCount(checkout.id)).toBe(1);
  });

  // --- Scenario: duplicate webhook arriving after the race scenario -----------------------------
  it('duplicate webhook after the PK5 race: successfulPaymentCount/markFinancialReview backstop still converges to exactly one OrderTicket', async () => {
    const checkout = await onlineCheckout('dup-webhook-after-race');
    const raced = await Promise.allSettled([
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-dup-webhook-race-a', actorId }),
      payments.createOnlinePaymentLink({ checkoutId: checkout.id, idempotencyKey: 'p2-dup-webhook-race-b', actorId }),
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

    // Same webhook event (same provider eventId) delivered twice -- a real provider redelivery
    // after the race scenario above. Sequential, not concurrent: concurrent identical-eventId
    // delivery is the webhook claim/lease system's own exclusivity concern (already proven by
    // phase6-persistence-concurrency's "serializes concurrent payment webhook claims" -- the loser
    // there correctly gets PAYMENT_WEBHOOK_PROCESSING_ACTIVE, not silently dropped). What this
    // scenario proves is that redelivery *after* the PK5 race resolves to exactly one committed
    // effect, never a second OrderTicket or a false financial-review trip.
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
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: checkout.id } } })).toBe(1);
    const afterDup = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(afterDup.status).toBe('ORDER_CREATED');
    // The pre-existing financial-review backstop must NOT have fired -- there was only ever one
    // successful payment, just delivered twice as a webhook event.
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id, status: PaymentIntentStatus.SUCCEEDED } })).toBe(1);
    expect(afterDup.status).not.toBe('FINANCIAL_REVIEW_REQUIRED');
  });
});
