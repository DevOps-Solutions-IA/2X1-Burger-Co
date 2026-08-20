import type { INestApplication } from '@nestjs/common';
import {
  OrderTicketType,
  PaymentIntentStatus,
  PaymentLinkStatus,
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
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

/**
 * PK4 (Recovery / Expiration), SOFIA Wave 2B.
 *
 * Verifies, with real Postgres:
 *  - CAN_EXPIRED_LINK_CREATE_NEW_LINK = true (an EXPIRED attempt is retryable)
 *  - CAN_MULTIPLE_ACTIVE_LINKS_EXIST = false (at most one non-terminal PaymentIntent per checkout)
 *  - CAN_MULTIPLE_SUCCESSFUL_PAYMENTS_EXIST = false, both at the new upstream guard (no new attempt
 *    is ever creatable once one has SUCCEEDED) and at the pre-existing downstream financial safety
 *    net (successfulPaymentCount / markFinancialReview), which this wave does not touch.
 *  - UNKNOWN_RESULT is never auto-resolved by the worker.
 *  - PaymentExpirationWorker actually transitions PaymentIntent / PaymentLink / OrderCheckout past
 *    their TTL -- confirming the pre-PK4 gap (nothing did this) is closed.
 */
describe('Phase 7 payment/checkout expiration and re-link policy', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaOrderCheckoutRepository;
  let gate: Phase5RuntimeGate;
  let checkouts: OrderCheckoutService;
  let payments: PaymentOrchestrationService;
  let webhooks: CanonicalPaymentWebhookService;
  let actorId: string;
  let worker: PaymentExpirationWorker;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Phase 7 expiration tests require an isolated _test database.');
    }
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.BOLD_API_KEY = 'phase7-test-key';
    process.env.BOLD_WEBHOOK_SECRET = 'phase7-test-webhook-secret';
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(PrismaOrderCheckoutRepository);
    gate = app.get(Phase5RuntimeGate);
    checkouts = app.get(OrderCheckoutService);
    payments = app.get(PaymentOrchestrationService);
    webhooks = app.get(CanonicalPaymentWebhookService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    actorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } })).id;
    await prisma.cashSession.create({ data: { openedById: actorId, openingAmount: 0 } });
    // Not registered in order-checkout.module.ts (see PK4 report: registration requires touching a
    // forbidden central module) -- constructed directly against the same DI-resolved collaborators
    // used elsewhere in this file, exactly as phase6-payment-webhook-fault-injection does for
    // CanonicalPaymentWebhookService.
    worker = new PaymentExpirationWorker(repository, gate);
  });

  async function onlineCheckout(label: string) {
    const product = await prisma.product.findFirst({ where: { isActive: true } })
      ?? await (async () => {
        const category = await prisma.category.findFirst() ?? await prisma.category.create({ data: { name: 'Phase 7', slug: `phase7-${label}` } });
        const unit = await prisma.unit.findFirst() ?? await prisma.unit.create({ data: { name: 'Unidad', code: `p7-${label}`, abbreviation: 'u' } });
        return prisma.product.create({
          data: {
            code: `P7-${label}`,
            name: 'Combo Phase 7',
            salePrice: 25_000,
            categoryId: category.id,
            unitId: unit.id,
            kind: ProductKind.DIRECT_STOCK,
            currentStock: 20,
            trackStock: true,
          },
        });
      })();
    const draftHash = `phase7-draft-${label}`;
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
        customerName: 'Cliente Phase 7',
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
    const checkout = await checkouts.createFromConfirmedSofiaDraft({
      draftId: draft.id,
      expectedDraftVersion: draft.version,
      expectedDraftHash: draftHash,
      confirmationHash: draft.confirmationHash!,
      idempotencyKey: `phase7-checkout-${label}`,
      actorId,
    });
    return checkout;
  }

  async function firstIntent(checkoutId: string, label: string) {
    return payments.createOnlinePaymentLink({
      checkoutId,
      idempotencyKey: `phase7-intent-${label}`,
      actorId,
    });
  }

  function boldSignature(rawBody: Buffer) {
    return createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET!).update(rawBody.toString('base64')).digest('hex');
  }

  it('confirms the pre-PK4 gap: nothing transitions a past-TTL intent without this worker', async () => {
    const checkout = await onlineCheckout('gap-check');
    const prepared = await firstIntent(checkout.id, 'gap-check');
    await prisma.paymentIntent.update({ where: { id: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    // No worker run here. A background sweep independent of PaymentExpirationWorker would have
    // already flipped this; it must still be LINK_READY.
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intent.status).toBe(PaymentIntentStatus.LINK_READY);
  });

  it('expires a stale payment intent and its payment link via the worker', async () => {
    const checkout = await onlineCheckout('expire-intent');
    const prepared = await firstIntent(checkout.id, 'expire-intent');
    await prisma.paymentIntent.update({ where: { id: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    await prisma.paymentLink.updateMany({ where: { paymentIntentId: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const result = await worker.runOnce();
    expect(result.intentsExpired).toBe(1);
    expect(result.linksExpired).toBe(1);

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intent.status).toBe(PaymentIntentStatus.EXPIRED);
    const link = await prisma.paymentLink.findFirstOrThrow({ where: { paymentIntentId: prepared.paymentIntent.id } });
    expect(link.status).toBe(PaymentLinkStatus.EXPIRED);
    const transition = await prisma.paymentTransition.findFirstOrThrow({
      where: { paymentIntentId: prepared.paymentIntent.id, toStatus: PaymentIntentStatus.EXPIRED },
    });
    expect(transition.reasonCode).toBe('PAYMENT_INTENT_TTL_ELAPSED');
  });

  it('is idempotent: a second cycle at the same instant finds nothing left to expire', async () => {
    const checkout = await onlineCheckout('idempotent-sweep');
    const prepared = await firstIntent(checkout.id, 'idempotent-sweep');
    await prisma.paymentIntent.update({ where: { id: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const first = await worker.runOnce();
    expect(first.intentsExpired).toBe(1);
    const second = await worker.runOnce();
    expect(second.intentsExpired).toBe(0);
    expect(second.linksExpired).toBe(0);
    expect(second.checkoutsExpired).toBe(0);
  });

  it('CAN_EXPIRED_LINK_CREATE_NEW_LINK: allows a fresh attempt once the previous one has expired', async () => {
    const checkout = await onlineCheckout('relink-after-expiry');
    const first = await firstIntent(checkout.id, 'relink-after-expiry');
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    await worker.runOnce();

    const second = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-relink-after-expiry-2',
      actorId,
    });
    expect(second.paymentIntent.id).not.toBe(first.paymentIntent.id);
    expect(second.paymentIntent.attemptNumber).toBe(2);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(2);
  });

  it('CAN_MULTIPLE_ACTIVE_LINKS_EXIST: rejects a second attempt while the first is still active', async () => {
    const checkout = await onlineCheckout('no-concurrent-active');
    await firstIntent(checkout.id, 'no-concurrent-active');

    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-no-concurrent-active-2',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_ATTEMPT_ACTIVE' }) });
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  it('treats a silently-elapsed intent TTL as immediately retryable even before the worker runs', async () => {
    const checkout = await onlineCheckout('lazy-expiry');
    const first = await firstIntent(checkout.id, 'lazy-expiry');
    // Backdate only the intent's expiresAt -- status is still LINK_READY, worker has not run.
    await prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const second = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-lazy-expiry-2',
      actorId,
    });
    expect(second.paymentIntent.attemptNumber).toBe(2);
    // The stale record is untouched by this call; only the worker durably transitions it.
    const stale = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: first.paymentIntent.id } });
    expect(stale.status).toBe(PaymentIntentStatus.LINK_READY);
  });

  it('permanently blocks relink once the latest attempt is UNKNOWN_RESULT', async () => {
    const checkout = await onlineCheckout('blocked-unknown-result');
    const prepared = await firstIntent(checkout.id, 'blocked-unknown-result');
    jest.spyOn(BoldPaymentProvider.prototype, 'createPayment').mockRejectedValueOnce(new Error('network timeout'));
    const token = prepared.publicPath!.split('/').pop()!;
    await expect(payments.startBoldPayment(token)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intent.status).toBe(PaymentIntentStatus.UNKNOWN_RESULT);

    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-blocked-unknown-result-2',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_RELINK_BLOCKED' }) });
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);

    // The worker must never touch UNKNOWN_RESULT even long after its TTL elapsed.
    await prisma.paymentIntent.update({ where: { id: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });
    await worker.runOnce();
    const stillUnknown = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(stillUnknown.status).toBe(PaymentIntentStatus.UNKNOWN_RESULT);
  });

  it('permanently blocks relink once the latest attempt is FINANCIAL_REVIEW_REQUIRED', async () => {
    const checkout = await onlineCheckout('blocked-financial-review');
    const prepared = await firstIntent(checkout.id, 'blocked-financial-review');
    await prisma.paymentIntent.update({
      where: { id: prepared.paymentIntent.id },
      data: { status: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED },
    });

    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-blocked-financial-review-2',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_RELINK_BLOCKED' }) });
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  it('CAN_MULTIPLE_SUCCESSFUL_PAYMENTS_EXIST: rejects any further attempt once a payment already SUCCEEDED, and the pre-existing financial safety net still catches a bypass path', async () => {
    const checkout = await onlineCheckout('no-second-success');
    const prepared = await firstIntent(checkout.id, 'no-second-success');
    const token = prepared.publicPath!.split('/').pop()!;
    jest.spyOn(BoldPaymentProvider.prototype, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-no-second-success',
      providerReference: `checkout_${prepared.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    await payments.startBoldPayment(token);
    const payload = {
      id: 'evt-no-second-success',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-no-second-success',
        reference: `checkout_${prepared.paymentIntent.id}`,
        metadata: { reference: `checkout_${prepared.paymentIntent.id}` },
        amount: { total: checkout.total, currency: 'COP' },
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

    // New upstream guard: the orchestration layer itself now refuses a further attempt outright.
    // The checkout-status check fires first (checkout is already ORDER_CREATED, not
    // CONFIRMED/PAYMENT_PENDING), which is a more specific/accurate rejection than the
    // intent-status PAYMENT_RELINK_BLOCKED check that would otherwise also apply here.
    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-no-second-success-2',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_NOT_PAYABLE' }) });

    // Pre-existing downstream backstop: even if a second intent reaches the webhook layer through a
    // path that bypasses PaymentOrchestrationService entirely (e.g. a legacy/admin-originated
    // intent), successfulPaymentCount / markFinancialReview must still catch it. This wave does not
    // modify canonical-payment-webhook.service.ts's financial-review logic.
    const secondIntent = await repository.createPaymentIntent({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-no-second-success-bypass',
      provider: 'BOLD' as never,
      expiresAt: new Date(Date.now() + 20 * 60_000),
      // Deliberately a no-op: this call simulates a caller that bypasses
      // PaymentOrchestrationService.assertRelinkAllowed entirely (see comment above), so the
      // relink policy itself must not be what blocks it -- the downstream financial safety net
      // (successfulPaymentCount / markFinancialReview) is what this test is actually exercising.
      relinkPolicy: () => {},
    });
    const firstAccountHash = (await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } })).providerAccountHash;
    // Real webhook evidence can only ever transition PENDING -> SUCCEEDED (assertPaymentTransition
    // has no CREATED -> SUCCEEDED edge); drive the bypass intent through the same
    // beginProviderPayment step a real second attempt would go through, so this exercises the exact
    // path the financial safety net has to defend, not a shortcut this test invents.
    await repository.beginProviderPayment({
      paymentIntentId: secondIntent.id,
      expectedVersion: secondIntent.version,
      providerReference: `checkout_${secondIntent.id}`,
      providerAccountHash: firstAccountHash,
      idempotencyKey: `${secondIntent.id}:provider-requested`,
    });
    const secondPayload = {
      id: 'evt-no-second-success-bypass',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-no-second-success-bypass',
        reference: `checkout_${secondIntent.id}`,
        metadata: { reference: `checkout_${secondIntent.id}` },
        amount: { total: checkout.total, currency: 'COP' },
      },
    };
    const secondRawBody = Buffer.from(JSON.stringify(secondPayload));
    const secondResult = await webhooks.processBold({
      rawPayload: secondPayload,
      rawBody: secondRawBody,
      headers: { 'x-bold-signature': boldSignature(secondRawBody), 'x-bold-merchant-id': 'merchant-1' },
    });
    expect(secondResult.processedStatus).toBe('FINANCIAL_REVIEW_REQUIRED');
    const afterSecond = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(afterSecond.status).toBe('FINANCIAL_REVIEW_REQUIRED');
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: checkout.id } } })).toBe(1);
  });

  it('CHECKOUT_EXPIRED: rejects a new attempt once the checkout window has elapsed, even before the worker runs', async () => {
    const checkout = await onlineCheckout('checkout-lazy-expired');
    await firstIntent(checkout.id, 'checkout-lazy-expired');
    await prisma.orderCheckout.update({ where: { id: checkout.id }, data: { expiresAt: new Date(0) } });

    await expect(payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-checkout-lazy-expired-2',
      actorId,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_EXPIRED' }) });
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  it('still replays the exact same idempotencyKey after the checkout has expired, without creating a duplicate', async () => {
    const checkout = await onlineCheckout('checkout-expired-replay');
    const first = await firstIntent(checkout.id, 'checkout-expired-replay');
    await prisma.orderCheckout.update({ where: { id: checkout.id }, data: { expiresAt: new Date(0) } });

    const replay = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: 'phase7-intent-checkout-expired-replay',
      actorId,
    });
    expect(replay.paymentIntent.id).toBe(first.paymentIntent.id);
    expect(replay.replayed).toBe(true);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  it('expires an idle checkout stuck in PAYMENT_PENDING past its own deadline and cascades to its still-open intent and link', async () => {
    const checkout = await onlineCheckout('checkout-sweep');
    const prepared = await firstIntent(checkout.id, 'checkout-sweep');
    // The checkout's own window closes well before its latest intent's independent TTL.
    await prisma.orderCheckout.update({ where: { id: checkout.id }, data: { expiresAt: new Date(0) } });
    const intentBefore = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intentBefore.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    const result = await worker.runOnce();
    expect(result.checkoutsExpired).toBe(1);
    expect(result.intentsExpired).toBe(1);

    const checkoutAfter = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(checkoutAfter.status).toBe('EXPIRED');
    const intentAfter = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intentAfter.status).toBe(PaymentIntentStatus.EXPIRED);
  });

  it('never expires a checkout that has already progressed past PAYMENT_PENDING', async () => {
    const checkout = await onlineCheckout('checkout-no-clobber');
    const prepared = await firstIntent(checkout.id, 'checkout-no-clobber');
    const token = prepared.publicPath!.split('/').pop()!;
    jest.spyOn(BoldPaymentProvider.prototype, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-no-clobber',
      providerReference: `checkout_${prepared.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    await payments.startBoldPayment(token);
    const payload = {
      id: 'evt-no-clobber',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-no-clobber',
        reference: `checkout_${prepared.paymentIntent.id}`,
        metadata: { reference: `checkout_${prepared.paymentIntent.id}` },
        amount: { total: checkout.total, currency: 'COP' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    await webhooks.processBold({
      rawPayload: payload,
      rawBody,
      headers: { 'x-bold-signature': boldSignature(rawBody), 'x-bold-merchant-id': 'merchant-1' },
    });
    await prisma.orderCheckout.update({ where: { id: checkout.id }, data: { expiresAt: new Date(0) } });

    const result = await worker.runOnce();
    expect(result.checkoutsExpired).toBe(0);
    const checkoutAfter = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(checkoutAfter.status).toBe('ORDER_CREATED');
  });

  it('does nothing when Phase5RuntimeGate PAYMENT_ORCHESTRATION capability is disabled', async () => {
    const checkout = await onlineCheckout('gate-disabled');
    const prepared = await firstIntent(checkout.id, 'gate-disabled');
    await prisma.paymentIntent.update({ where: { id: prepared.paymentIntent.id }, data: { expiresAt: new Date(0) } });

    const previous = process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED;
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'false';
    try {
      await expect(worker.runOnce()).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_OPERATION_DISABLED' }) });
    } finally {
      process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = previous;
    }
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.paymentIntent.id } });
    expect(intent.status).toBe(PaymentIntentStatus.LINK_READY);
  });
});
