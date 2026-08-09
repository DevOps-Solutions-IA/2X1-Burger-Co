import { PaymentIntentProvider, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { PaymentOrchestrationService } from './payment-orchestration.service';

describe('PaymentOrchestrationService failure protocol', () => {
  const checkout = {
    id: 'checkout-1',
    fulfillment: 'TAKEAWAY',
    paymentPreference: SofiaPaymentPreference.ONLINE,
    total: { toString: () => '25000' },
    customerSnapshot: {},
  };
  const intent = {
    id: 'intent-1',
    checkoutId: checkout.id,
    attemptNumber: 1,
    provider: PaymentIntentProvider.BOLD,
    status: PaymentIntentStatus.LINK_READY,
    amount: { toString: () => '25000' },
    currency: 'COP',
    providerPaymentId: null,
    providerReference: null,
    expiresAt: new Date(Date.now() + 60_000),
    version: 2,
    checkout,
  };

  function harness(input: {
    status?: PaymentIntentStatus;
    providerResult?: 'success' | 'timeout';
    unknownResolvedStatus?: PaymentIntentStatus;
  } = {}) {
    const status = input.status ?? PaymentIntentStatus.LINK_READY;
    const paymentIntent = { ...intent, status };
    const providerReference = `checkout_${intent.id}`;
    const pendingIntent = {
      ...paymentIntent,
      status: PaymentIntentStatus.PENDING,
      providerReference,
      providerAccountHash: null,
      version: 3,
    };
    const linkExpiry = new Date(Date.now() + 60_000);
    const repository = {
      findPaymentLinkById: jest.fn().mockResolvedValue({
        id: 'link-1',
        expiresAt: linkExpiry,
        revokedAt: null,
        status: 'ACTIVE',
        paymentIntent,
      }),
      beginProviderPayment: jest.fn().mockResolvedValue({ paymentIntent: pendingIntent, started: true }),
      bindProviderPaymentResult: jest.fn().mockResolvedValue({
        ...pendingIntent,
        providerPaymentId: 'bold-link-1',
        version: 4,
      }),
      markProviderPaymentUnknown: jest.fn().mockResolvedValue({
        paymentIntent: {
          ...pendingIntent,
          status: input.unknownResolvedStatus ?? PaymentIntentStatus.UNKNOWN_RESULT,
          version: 4,
        },
        marked: !input.unknownResolvedStatus,
      }),
      markPaymentLinkOpened: jest.fn(),
    };
    const bold = {
      createPayment: jest.fn().mockImplementation(() => input.providerResult === 'success'
        ? Promise.resolve({
            provider: 'BOLD',
            providerPaymentId: 'bold-link-1',
            providerReference,
            checkoutUrl: 'https://checkout.bold.test/link-1',
            status: 'PENDING',
            rawPayload: {},
          })
        : Promise.reject(new Error('provider timeout'))),
    };
    const service = new PaymentOrchestrationService(
      repository as never,
      { assertPaymentCombination: jest.fn() } as never,
      { assertEnabled: jest.fn().mockResolvedValue(undefined) } as never,
      bold as never,
      { log: jest.fn() } as never,
      { verify: jest.fn().mockReturnValue({ linkId: 'link-1', expiresAt: linkExpiry }) } as never,
    );
    return { service, repository, bold };
  }

  it('persists UNKNOWN_RESULT after a provider timeout', async () => {
    const { service, repository, bold } = harness();
    await expect(service.startBoldPayment('public-token')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    expect(bold.createPayment).toHaveBeenCalledTimes(1);
    expect(repository.beginProviderPayment).toHaveBeenCalledWith(expect.objectContaining({
      providerReference: 'checkout_intent-1',
      idempotencyKey: 'intent-1:provider-requested',
    }));
    expect(repository.markProviderPaymentUnknown).toHaveBeenCalledWith(expect.objectContaining({
      providerReference: 'checkout_intent-1',
      idempotencyKey: 'intent-1:unknown-result',
    }));
    expect(repository.beginProviderPayment.mock.invocationCallOrder[0]).toBeLessThan(
      bold.createPayment.mock.invocationCallOrder[0]!,
    );
  });

  it('never retries a persisted unknown provider result', async () => {
    const { service, repository, bold } = harness({ status: PaymentIntentStatus.UNKNOWN_RESULT });
    await expect(service.startBoldPayment('public-token')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    expect(bold.createPayment).not.toHaveBeenCalled();
    expect(repository.beginProviderPayment).not.toHaveBeenCalled();
    expect(repository.markProviderPaymentUnknown).not.toHaveBeenCalled();
  });

  it('uses the pre-bound deterministic reference for the provider request and result binding', async () => {
    const { service, repository, bold } = harness({ providerResult: 'success' });

    await expect(service.startBoldPayment('public-token')).resolves.toMatchObject({
      paymentIntent: {
        id: 'intent-1',
        status: PaymentIntentStatus.PENDING,
        providerReference: 'checkout_intent-1',
        providerPaymentId: 'bold-link-1',
      },
      checkoutUrl: 'https://checkout.bold.test/link-1',
      replayed: false,
    });
    expect(bold.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderReference: 'checkout_intent-1',
    }));
    expect(repository.bindProviderPaymentResult).toHaveBeenCalledWith({
      paymentIntentId: 'intent-1',
      providerReference: 'checkout_intent-1',
      providerPaymentId: 'bold-link-1',
    });
  });

  it('returns the webhook-resolved intent when a timeout races with verified success', async () => {
    const { service, repository } = harness({ unknownResolvedStatus: PaymentIntentStatus.SUCCEEDED });

    await expect(service.startBoldPayment('public-token')).resolves.toMatchObject({
      paymentIntent: { id: 'intent-1', status: PaymentIntentStatus.SUCCEEDED },
      checkoutUrl: null,
      replayed: true,
    });
    expect(repository.markProviderPaymentUnknown).toHaveBeenCalledTimes(1);
  });
});
