import { PaymentIntentProvider, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';
import { PaymentOrchestrationService } from './payment-orchestration.service';

describe('Bold create and canonical webhook integration', () => {
  const originalAccount = process.env.BOLD_EXPECTED_ACCOUNT_ID;

  afterEach(() => {
    if (originalAccount === undefined) delete process.env.BOLD_EXPECTED_ACCOUNT_ID;
    else process.env.BOLD_EXPECTED_ACCOUNT_ID = originalAccount;
  });

  it('reconciles a verified webhook that arrives before createPayment returns', async () => {
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';
    const expiresAt = new Date(Date.now() + 60_000);
    const checkout = {
      id: 'checkout-1',
      status: 'PAYMENT_PENDING',
      fulfillment: 'TAKEAWAY',
      paymentPreference: SofiaPaymentPreference.ONLINE,
      total: { toString: () => '25000' },
      customerSnapshot: {},
    };
    let paymentIntent = {
      id: 'intent-1',
      checkoutId: checkout.id,
      attemptNumber: 1,
      provider: PaymentIntentProvider.BOLD,
      status: PaymentIntentStatus.LINK_READY as PaymentIntentStatus,
      amount: { toString: () => '25000' },
      currency: 'COP',
      providerPaymentId: null as string | null,
      providerReference: null as string | null,
      providerAccountHash: null as string | null,
      expiresAt,
      version: 2,
      checkout,
    };
    const repository = {
      findPaymentLinkById: jest.fn().mockImplementation(async () => ({
        id: 'link-1',
        expiresAt,
        revokedAt: null,
        status: 'ACTIVE',
        paymentIntent,
      })),
      beginProviderPayment: jest.fn().mockImplementation(async (input) => {
        paymentIntent = {
          ...paymentIntent,
          status: PaymentIntentStatus.PENDING,
          providerReference: input.providerReference,
          providerAccountHash: input.providerAccountHash,
          version: paymentIntent.version + 1,
        };
        return { paymentIntent, started: true };
      }),
      bindProviderPaymentResult: jest.fn().mockImplementation(async (input) => {
        if (paymentIntent.providerReference !== input.providerReference) throw new Error('reference mismatch');
        if (paymentIntent.providerPaymentId && paymentIntent.providerPaymentId !== input.providerPaymentId) {
          throw new Error('payment id mismatch');
        }
        if (!paymentIntent.providerPaymentId) {
          paymentIntent = { ...paymentIntent, providerPaymentId: input.providerPaymentId, version: paymentIntent.version + 1 };
        }
        return paymentIntent;
      }),
      markProviderPaymentUnknown: jest.fn(),
      markPaymentLinkOpened: jest.fn(),
      findIntentByProvider: jest.fn().mockImplementation(async (input) =>
        input.providerReference === paymentIntent.providerReference ? paymentIntent : null),
      claimWebhookEvidence: jest.fn().mockResolvedValue({
        state: 'CLAIMED',
        webhookId: 'webhook-1',
        paymentIntentId: 'intent-1',
        transitionApplied: false,
        attempt: 1,
      }),
      transitionPayment: jest.fn().mockImplementation(async (input) => {
        if (input.expectedVersion !== paymentIntent.version) throw new Error('version mismatch');
        paymentIntent = {
          ...paymentIntent,
          status: input.toStatus,
          providerPaymentId: input.providerPaymentId ?? paymentIntent.providerPaymentId,
          providerReference: input.providerReference ?? paymentIntent.providerReference,
          version: paymentIntent.version + 1,
        };
        return paymentIntent;
      }),
      successfulPaymentCount: jest.fn().mockResolvedValue(1),
      markFinancialReview: jest.fn(),
      markCheckoutPaymentVerified: jest.fn(),
      assertWebhookClaimOwned: jest.fn(),
      completeWebhookClaim: jest.fn(),
      failWebhookClaim: jest.fn(),
    };

    let providerRequestStarted!: () => void;
    let releaseProvider!: () => void;
    const requestStarted = new Promise<void>((resolve) => { providerRequestStarted = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const bold = {
      createPayment: jest.fn().mockImplementation(async (input) => {
        providerRequestStarted();
        await providerRelease;
        return {
          provider: 'BOLD',
          providerPaymentId: 'bold-payment-1',
          providerReference: input.orderReference,
          checkoutUrl: 'https://checkout.bold.test/link-1',
          status: 'PENDING',
          rawPayload: {},
        };
      }),
      parseWebhook: jest.fn().mockReturnValue({
        eventId: 'event-1',
        eventType: 'PAYMENT',
        providerPaymentId: 'bold-payment-1',
        providerReference: 'checkout_intent-1',
        orderReference: 'checkout_intent-1',
        status: 'APPROVED',
        amount: 25000,
        currency: 'COP',
        rawPayload: { eventId: 'event-1' },
      }),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };
    const gate = { assertEnabled: jest.fn().mockResolvedValue(undefined) };
    const kitchen = { continueAfterVerifiedPayment: jest.fn().mockResolvedValue({ state: 'APPLIED' }) };
    const orchestration = new PaymentOrchestrationService(
      repository as never,
      { assertPaymentCombination: jest.fn() } as never,
      gate as never,
      bold as never,
      { log: jest.fn() } as never,
      { verify: jest.fn().mockReturnValue({ linkId: 'link-1', expiresAt }) } as never,
    );
    const webhooks = new CanonicalPaymentWebhookService(
      repository as never,
      bold as never,
      gate as never,
      kitchen as never,
    );

    const create = orchestration.startBoldPayment('public-token');
    await requestStarted;
    expect(paymentIntent).toMatchObject({
      status: PaymentIntentStatus.PENDING,
      providerReference: 'checkout_intent-1',
      providerAccountHash: createHash('sha256').update('merchant-1').digest('hex'),
    });

    await expect(webhooks.processBold({
      rawPayload: {},
      rawBody: Buffer.from('{"id":"event-1"}'),
      headers: { 'x-bold-merchant-id': 'merchant-1' },
    })).resolves.toMatchObject({
      paymentIntentId: 'intent-1',
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    });
    releaseProvider();

    await expect(create).resolves.toMatchObject({
      paymentIntent: {
        id: 'intent-1',
        status: PaymentIntentStatus.SUCCEEDED,
        providerPaymentId: 'bold-payment-1',
        providerReference: 'checkout_intent-1',
      },
      replayed: false,
    });
    expect(repository.markProviderPaymentUnknown).not.toHaveBeenCalled();
    expect(kitchen.continueAfterVerifiedPayment).toHaveBeenCalledWith('checkout-1', null);
  });
});
