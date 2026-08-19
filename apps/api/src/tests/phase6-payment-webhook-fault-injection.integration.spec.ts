import type { INestApplication } from '@nestjs/common';
import {
  OrderTicketType,
  PaymentIntentStatus,
  Prisma,
  ProductKind,
  SofiaPaymentPreference,
} from '@prisma/client';
import { createHmac } from 'node:crypto';
import { CanonicalPaymentWebhookService } from '../modules/order-checkout/canonical-payment-webhook.service';
import { KitchenEligibilityService } from '../modules/order-checkout/kitchen-eligibility.service';
import { OrderCheckoutService } from '../modules/order-checkout/order-checkout.service';
import { PaymentOrchestrationService } from '../modules/order-checkout/payment-orchestration.service';
import { Phase5RuntimeGate } from '../modules/order-checkout/phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from '../modules/order-checkout/persistence/prisma-order-checkout.repository';
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

class SimulatedProcessCrash extends Error {}

describe('Phase 6 PostgreSQL payment webhook fault recovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaOrderCheckoutRepository;
  let bold: BoldPaymentProvider;
  let gate: Phase5RuntimeGate;
  let kitchen: KitchenEligibilityService;
  let checkouts: OrderCheckoutService;
  let payments: PaymentOrchestrationService;
  let actorId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Phase 6 fault injection requires an isolated _test database.');
    }
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.BOLD_API_KEY = 'phase6-fault-test-key';
    process.env.BOLD_WEBHOOK_SECRET = 'phase6-fault-test-webhook-secret';
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(PrismaOrderCheckoutRepository);
    bold = app.get(BoldPaymentProvider);
    gate = app.get(Phase5RuntimeGate);
    kitchen = app.get(KitchenEligibilityService);
    checkouts = app.get(OrderCheckoutService);
    payments = app.get(PaymentOrchestrationService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    actorId = (await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@2x1burgerco.local' },
    })).id;
    // PK3: the SUCCEEDED webhook consequence now closes the loop into
    // OrdersService.createFromCanonicalCheckout, which -- like every other order-creating path in
    // this codebase -- requires an open cash session.
    await prisma.cashSession.create({ data: { openedById: actorId, openingAmount: 0 } });
  });

  function service(
    repositoryOverride: PrismaOrderCheckoutRepository = repository,
    kitchenOverride: KitchenEligibilityService = kitchen,
  ) {
    return new CanonicalPaymentWebhookService(repositoryOverride, bold, gate, kitchenOverride);
  }

  function proxy<T extends object>(target: T, overrides: Partial<Record<keyof T, unknown>>): T {
    return new Proxy(target, {
      get(current, property) {
        if (property in overrides) return overrides[property as keyof T];
        const value = Reflect.get(current, property, current) as unknown;
        return typeof value === 'function' ? value.bind(current) : value;
      },
    });
  }

  async function preparedWebhook(label: string, options: { dataStatus?: string } = {}) {
    const product = await prisma.product.findFirst({ where: { isActive: true } })
      ?? await (async () => {
        const category = await prisma.category.findFirst()
          ?? await prisma.category.create({ data: { name: 'Phase 6 Faults', slug: `phase6-faults-${label}` } });
        const unit = await prisma.unit.findFirst()
          ?? await prisma.unit.create({ data: { name: 'Unidad', code: `fault-${label}`, abbreviation: 'u' } });
        return prisma.product.create({
          data: {
            code: `FAULT-${label}`,
            name: 'Combo Phase 6 Fault Injection',
            salePrice: 25_000,
            categoryId: category.id,
            unitId: unit.id,
            kind: ProductKind.DIRECT_STOCK,
            currentStock: 20,
            trackStock: true,
          },
        });
      })();
    const draftHash = `phase6-fault-draft-${label}`;
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
        customerName: 'Cliente Fault Injection',
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
      idempotencyKey: `phase6-fault-checkout-${label}`,
      actorId,
    });
    const prepared = await payments.createOnlinePaymentLink({
      checkoutId: checkout.id,
      idempotencyKey: `phase6-fault-intent-${label}`,
      actorId,
    });
    const publicReference = prepared.publicPath!.split('/').pop()!;
    const providerCreateSpy = jest.spyOn(BoldPaymentProvider.prototype, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: `provider-payment-${label}`,
      providerReference: `checkout_${prepared.paymentIntent.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    await payments.startBoldPayment(publicReference);

    const payload = {
      id: `event-${label}`,
      type: 'PAYMENT',
      data: {
        status: options.dataStatus ?? 'APPROVED',
        payment_id: `provider-payment-${label}`,
        reference: `checkout_${prepared.paymentIntent.id}`,
        metadata: { reference: `checkout_${prepared.paymentIntent.id}` },
        amount: { total: Number(checkout.total), currency: 'COP' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET!)
      .update(rawBody.toString('base64'))
      .digest('hex');
    return {
      checkout,
      intentId: prepared.paymentIntent.id,
      providerCreateSpy,
      command: {
        rawPayload: payload,
        rawBody,
        headers: {
          'x-bold-signature': signature,
          'x-bold-merchant-id': 'merchant-1',
        },
      },
    };
  }

  async function expireClaim(eventId: string) {
    await prisma.paymentWebhookEvent.update({
      where: { provider_eventId: { provider: 'BOLD', eventId } },
      // Recovery is deliberately proven from normalized columns, not provider redelivery or raw payload.
      data: { processingLeaseExpiresAt: new Date(0), rawPayload: Prisma.JsonNull },
    });
  }

  async function expectSingleEffects(input: {
    checkoutId: string;
    intentId: string;
    eventId: string;
    expectedCheckoutVersion?: number;
    expectedKitchenEligibleAt?: Date | null;
  }) {
    expect(await prisma.paymentWebhookEvent.count({
      where: { provider: 'BOLD', eventId: input.eventId },
    })).toBe(1);
    expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'BOLD', eventId: input.eventId } },
    })).toMatchObject({
      processedStatus: 'PROCESSED',
      processingAttempts: 2,
      deterministicResult: {
        processedStatus: 'PROCESSED',
        paymentIntentId: input.intentId,
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
      },
    });
    expect(await prisma.paymentTransition.count({
      where: {
        paymentIntentId: input.intentId,
        webhookEvent: { provider: 'BOLD', eventId: input.eventId },
        toStatus: PaymentIntentStatus.SUCCEEDED,
      },
    })).toBe(1);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: input.checkoutId } })).toBe(1);
    expect(await prisma.paymentLink.count({ where: { paymentIntentId: input.intentId } })).toBe(1);
    // PK3: the SUCCEEDED webhook's consequence -- KitchenEligibility -> canonical OrderTicket --
    // must converge on exactly one OrderTicket no matter how many times the claim/recovery/replay
    // path above re-entered this checkout.
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: input.checkoutId } } })).toBe(1);
    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: input.checkoutId } });
    expect(checkout.status).toBe('ORDER_CREATED');
    expect(checkout.orderTicketId).not.toBeNull();
    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: checkout.orderTicketId! } });
    expect(order.createdById).toBe('sofia-order-creation-system');
    if (input.expectedCheckoutVersion != null) expect(checkout.version).toBe(input.expectedCheckoutVersion);
    if (input.expectedKitchenEligibleAt !== undefined) {
      expect(checkout.kitchenEligibleAt?.getTime() ?? null).toBe(input.expectedKitchenEligibleAt?.getTime() ?? null);
    }
  }

  it('recovers the same event after a crash following evidence persistence and before transition', async () => {
    const prepared = await preparedWebhook('after-evidence');
    const crashingRepository = proxy(repository, {
      claimWebhookEvidence: async (...args: Parameters<PrismaOrderCheckoutRepository['claimWebhookEvidence']>) => {
        const claim = await repository.claimWebhookEvidence(...args);
        throw new SimulatedProcessCrash(`after evidence ${claim.state}`);
      },
    });

    await expect(service(crashingRepository).processBold(prepared.command)).rejects.toThrow(SimulatedProcessCrash);
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'event-after-evidence' } })).toBe(1);
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(0);

    await expireClaim('event-after-evidence');
    const parseSpy = jest.spyOn(bold, 'parseWebhook');
    const verifySpy = jest.spyOn(bold, 'verifyWebhookSignature');
    await expect(service().recoverPendingBatch('restart-worker', new Date(), 10)).resolves.toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
    await expectSingleEffects({
      checkoutId: prepared.checkout.id,
      intentId: prepared.intentId,
      eventId: 'event-after-evidence',
    });
  });

  it('recovers after transition commit and before kitchen without a duplicate transition', async () => {
    const prepared = await preparedWebhook('after-transition');
    const crashingRepository = proxy(repository, {
      transitionPayment: async (...args: Parameters<PrismaOrderCheckoutRepository['transitionPayment']>) => {
        await repository.transitionPayment(...args);
        throw new SimulatedProcessCrash('after transition');
      },
      failWebhookClaim: async () => undefined,
    });

    await expect(service(crashingRepository).processBold(prepared.command)).rejects.toThrow(SimulatedProcessCrash);
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(1);
    expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'BOLD', eventId: 'event-after-transition' } },
    })).toMatchObject({ processedStatus: 'VALIDATED', deterministicResult: null });
    expect((await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } })).status)
      .toBe('PAYMENT_PENDING');

    await expireClaim('event-after-transition');
    const parseSpy = jest.spyOn(bold, 'parseWebhook');
    await expect(service().recoverPendingBatch('restart-worker', new Date(), 10)).resolves.toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
    await expectSingleEffects({
      checkoutId: prepared.checkout.id,
      intentId: prepared.intentId,
      eventId: 'event-after-transition',
    });
  });

  it('persists verified payment truth and resumes kitchen after its independent gate is enabled', async () => {
    const prepared = await preparedWebhook('kitchen-gate-disabled');
    process.env.PHASE5_KITCHEN_ENABLED = 'false';

    try {
      await expect(service().processBold(prepared.command)).resolves.toMatchObject({
        processedStatus: 'PROCESSED',
        paymentIntentId: prepared.intentId,
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
      });

      expect(await prisma.paymentTransition.count({
        where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
      })).toBe(1);
      expect(await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.intentId } }))
        .toMatchObject({ status: PaymentIntentStatus.SUCCEEDED });
      expect(await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } }))
        .toMatchObject({ status: 'PAYMENT_VERIFIED', kitchenEligibleAt: null });
      expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({
        where: { provider_eventId: { provider: 'BOLD', eventId: 'event-kitchen-gate-disabled' } },
      })).toMatchObject({
        processedStatus: 'PROCESSED',
        retryable: false,
        processingAttempts: 1,
      });

      process.env.PHASE5_KITCHEN_ENABLED = 'true';
      const first = await kitchen.continueAfterVerifiedPayment(prepared.checkout.id, null);
      expect(first).toMatchObject({ state: 'APPLIED', replayed: false });
      // Replaying the same consequence (e.g. a second webhook checkpoint pass) must resolve to the
      // exact same OrderTicket, never a second one -- OrdersService.createFromCanonicalCheckout is
      // itself idempotent (locked, `orderTicketId: null` in its WHERE clause).
      const second = await kitchen.continueAfterVerifiedPayment(prepared.checkout.id, null);
      expect(second).toMatchObject({ state: 'APPLIED', replayed: true });
      expect(second.order?.id).toBe(first.order?.id);

      const resumed = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
      expect(resumed).toMatchObject({ status: 'ORDER_CREATED' });
      expect(resumed.kitchenEligibleAt).not.toBeNull();
      expect(resumed.orderTicketId).not.toBeNull();
      expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(1);
      expect(await prisma.paymentTransition.count({
        where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
      })).toBe(1);
      expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.PHASE5_KITCHEN_ENABLED = 'true';
    }
  });

  it('recovers after kitchen commit and before deterministic result without a duplicate kitchen effect or a duplicate OrderTicket', async () => {
    const prepared = await preparedWebhook('after-kitchen');
    const crashingRepository = proxy(repository, {
      completeWebhookClaim: async () => {
        throw new SimulatedProcessCrash('after kitchen before deterministic result');
      },
      failWebhookClaim: async () => undefined,
    });

    await expect(service(crashingRepository).processBold(prepared.command))
      .rejects.toThrow(SimulatedProcessCrash);
    const afterCrash = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    // PK3: order creation happens inside continueAfterVerifiedPayment, which fully committed before
    // the simulated crash point (completeWebhookClaim) -- so the OrderTicket already exists.
    expect(afterCrash.status).toBe('ORDER_CREATED');
    expect(afterCrash.kitchenEligibleAt).not.toBeNull();
    expect(afterCrash.orderTicketId).not.toBeNull();
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(1);
    expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'BOLD', eventId: 'event-after-kitchen' } },
    })).toMatchObject({ processedStatus: 'DOWNSTREAM_APPLIED', deterministicResult: null });

    await expireClaim('event-after-kitchen');
    const parseSpy = jest.spyOn(bold, 'parseWebhook');
    await expect(service().recoverPendingBatch('restart-worker', new Date(), 10)).resolves.toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
    await expectSingleEffects({
      checkoutId: prepared.checkout.id,
      intentId: prepared.intentId,
      eventId: 'event-after-kitchen',
      expectedCheckoutVersion: afterCrash.version,
      expectedKitchenEligibleAt: afterCrash.kitchenEligibleAt,
    });
    // The replay above must not have created a second OrderTicket for the same checkout.
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(1);
    const finalCheckout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(finalCheckout.orderTicketId).toBe(afterCrash.orderTicketId);
  });

  it('does not reclaim an active lease and reclaims it after expiry with one winner', async () => {
    const prepared = await preparedWebhook('lease-reclaim');
    const crashingRepository = proxy(repository, {
      claimWebhookEvidence: async (...args: Parameters<PrismaOrderCheckoutRepository['claimWebhookEvidence']>) => {
        const claim = await repository.claimWebhookEvidence(...args);
        throw new SimulatedProcessCrash(`claimed ${claim.state}`);
      },
    });
    await expect(service(crashingRepository).processBold(prepared.command)).rejects.toThrow(SimulatedProcessCrash);

    await expect(service().recoverPendingBatch('active-worker', new Date(), 10)).resolves.toMatchObject({
      candidates: 0,
      completed: 0,
    });
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(0);

    await expireClaim('event-lease-reclaim');
    const recoveries = await Promise.all([
      service().recoverPendingBatch('restart-a', new Date(), 10),
      service().recoverPendingBatch('restart-b', new Date(), 10),
    ]);
    expect(recoveries.reduce((sum, entry) => sum + entry.completed, 0)).toBe(1);
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
    await expectSingleEffects({
      checkoutId: prepared.checkout.id,
      intentId: prepared.intentId,
      eventId: 'event-lease-reclaim',
    });
  });

  it('closes an expired claim at the bounded attempt limit without a financial transition', async () => {
    const prepared = await preparedWebhook('attempt-limit');
    const crashingRepository = proxy(repository, {
      claimWebhookEvidence: async (...args: Parameters<PrismaOrderCheckoutRepository['claimWebhookEvidence']>) => {
        const claim = await repository.claimWebhookEvidence(...args);
        throw new SimulatedProcessCrash(`claimed ${claim.state}`);
      },
    });
    await expect(service(crashingRepository).processBold(prepared.command)).rejects.toThrow(SimulatedProcessCrash);
    await prisma.paymentWebhookEvent.update({
      where: { provider_eventId: { provider: 'BOLD', eventId: 'event-attempt-limit' } },
      data: { processingAttempts: 5, processingLeaseExpiresAt: new Date(0) },
    });

    await expect(service().recoverPendingBatch('bounded-worker', new Date(), 10)).resolves.toMatchObject({
      blocked: 1,
      completed: 0,
    });
    expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'BOLD', eventId: 'event-attempt-limit' } },
    })).toMatchObject({
      processedStatus: 'FAILED',
      processingAttempts: 5,
      resultCode: 'PROCESSING_ATTEMPTS_EXHAUSTED',
      retryable: false,
    });
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(0);
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
  });

  it('DUPLICATE_WEBHOOK_SINGLE_TICKET: redelivering the exact same event produces exactly one OrderTicket', async () => {
    const prepared = await preparedWebhook('duplicate-webhook');

    const first = await service().processBold(prepared.command);
    expect(first).toMatchObject({ processedStatus: 'PROCESSED', paymentStatus: PaymentIntentStatus.SUCCEEDED });

    // Real-world provider redelivery: identical eventId, identical payload, sent again.
    const second = await service().processBold(prepared.command);
    expect(second).toMatchObject({
      processedStatus: 'DUPLICATE_REPLAY',
      paymentIntentId: prepared.intentId,
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    });

    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(1);
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(1);
    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(checkout.status).toBe('ORDER_CREATED');
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENT_WEBHOOK_SINGLE_TICKET: N truly concurrent deliveries of the same event produce exactly one OrderTicket', async () => {
    const prepared = await preparedWebhook('concurrent-webhook');

    const outcomes = await Promise.allSettled([
      service().processBold(prepared.command),
      service().processBold(prepared.command),
      service().processBold(prepared.command),
    ]);

    // Every settled outcome must be financially safe: either the real processing result, a
    // deterministic replay, or a rejection because another attempt's lease was active -- never a
    // second/duplicate financial transition.
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        expect(['PROCESSED', 'DUPLICATE_REPLAY']).toContain(outcome.value.processedStatus);
      } else {
        expect(outcome.reason).toMatchObject({
          response: expect.objectContaining({ code: 'PAYMENT_WEBHOOK_PROCESSING_ACTIVE' }),
        });
      }
    }

    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(1);
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(1);
    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(checkout.status).toBe('ORDER_CREATED');
    expect(prepared.providerCreateSpy).toHaveBeenCalledTimes(1);
  });

  it('FINANCIAL_REVIEW_REQUIRED: a second successful payment on the same checkout blocks Kitchen and creates no OrderTicket', async () => {
    const prepared = await preparedWebhook('financial-review');
    // Simulate a second, independently-successful PaymentIntent attempt already existing for this
    // checkout (e.g. a stale retried attempt that also got authoritatively approved) -- never
    // fabricated inside CanonicalPaymentWebhookService itself, only as the real repository/DB state
    // it must react to.
    await prisma.paymentIntent.create({
      data: {
        checkoutId: prepared.checkout.id,
        attemptNumber: 2,
        idempotencyKey: 'phase6-fault-intent-financial-review-2',
        provider: 'BOLD',
        amount: prepared.checkout.total,
        currency: 'COP',
        status: PaymentIntentStatus.SUCCEEDED,
        providerPaymentId: 'provider-payment-financial-review-shadow',
        providerAccountHash: prepared.command.headers['x-bold-merchant-id'] as string,
      },
    });

    await expect(service().processBold(prepared.command)).resolves.toMatchObject({
      processedStatus: 'FINANCIAL_REVIEW_REQUIRED',
      paymentIntentId: prepared.intentId,
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    });

    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(checkout.status).toBe('FINANCIAL_REVIEW_REQUIRED');
    expect(checkout.orderTicketId).toBeNull();
    expect(checkout.kitchenEligibleAt).toBeNull();
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(0);
  });

  it('UNKNOWN_RESULT: a still-inconclusive webhook on an already-UNKNOWN_RESULT intent never opens Kitchen or creates an OrderTicket', async () => {
    const prepared = await preparedWebhook('unknown-result', { dataStatus: 'PROCESSING' });
    // Simulate the real precondition (e.g. provider communication timeout during startBoldPayment)
    // that leaves the PaymentIntent as UNKNOWN_RESULT before any webhook has resolved it.
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.intentId } });
    await prisma.paymentIntent.update({
      where: { id: prepared.intentId },
      data: { status: PaymentIntentStatus.UNKNOWN_RESULT, version: { increment: 1 } },
    });

    await expect(service().processBold(prepared.command)).resolves.toMatchObject({
      processedStatus: 'DUPLICATE_REPLAY',
      paymentIntentId: prepared.intentId,
      paymentStatus: PaymentIntentStatus.UNKNOWN_RESULT,
    });

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: prepared.intentId } });
    expect(intent.status).toBe(PaymentIntentStatus.UNKNOWN_RESULT);
    expect(intent.version).toBe(before.version + 1); // only the direct DB mutation above, no webhook transition
    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.SUCCEEDED },
    })).toBe(0);
    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(checkout.status).toBe('PAYMENT_PENDING');
    expect(checkout.orderTicketId).toBeNull();
    expect(checkout.kitchenEligibleAt).toBeNull();
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(0);
  });

  it('FAILED: a declined webhook never opens Kitchen or creates an OrderTicket', async () => {
    const prepared = await preparedWebhook('failed-webhook', { dataStatus: 'REJECTED' });

    await expect(service().processBold(prepared.command)).resolves.toMatchObject({
      processedStatus: 'PROCESSED',
      paymentIntentId: prepared.intentId,
      paymentStatus: PaymentIntentStatus.FAILED,
    });

    expect(await prisma.paymentTransition.count({
      where: { paymentIntentId: prepared.intentId, toStatus: PaymentIntentStatus.FAILED },
    })).toBe(1);
    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: prepared.checkout.id } });
    expect(checkout.status).toBe('PAYMENT_PENDING');
    expect(checkout.orderTicketId).toBeNull();
    expect(checkout.kitchenEligibleAt).toBeNull();
    expect(await prisma.orderTicket.count({ where: { orderCheckout: { id: prepared.checkout.id } } })).toBe(0);
  });
});
