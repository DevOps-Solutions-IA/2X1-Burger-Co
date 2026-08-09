import { PaymentIntentProvider, PaymentIntentStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';

describe('CanonicalPaymentWebhookService recovery lifecycle', () => {
  const rawBody = Buffer.from('{"id":"evt-recovery"}');
  const accountHash = createHash('sha256').update('merchant-1').digest('hex');
  const parsed = {
    eventId: 'evt-recovery',
    eventType: 'PAYMENT',
    providerPaymentId: 'provider-payment-1',
    providerReference: 'checkout-1',
    orderReference: 'checkout-1',
    status: 'APPROVED' as const,
    amount: 30000,
    currency: 'COP',
    rawPayload: { eventId: 'evt-recovery', status: 'APPROVED' },
  };

  function harness(initialStatus: PaymentIntentStatus = PaymentIntentStatus.PENDING) {
    let intentStatus = initialStatus;
    const intent = () => ({
      id: 'intent-1',
      checkoutId: 'checkout-1',
      provider: PaymentIntentProvider.BOLD,
      status: intentStatus,
      amount: { toString: () => '30000' },
      currency: 'COP',
      providerAccountHash: accountHash,
      version: intentStatus === initialStatus ? 2 : 3,
      checkout: { status: 'PAYMENT_PENDING' },
    });
    const repository = {
      findIntentByProvider: jest.fn().mockImplementation(async () => intent()),
      claimWebhookEvidence: jest.fn().mockResolvedValue({
        state: 'CLAIMED',
        webhookId: 'webhook-1',
        paymentIntentId: 'intent-1',
        transitionApplied: false,
        attempt: 1,
      }),
      transitionPayment: jest.fn().mockImplementation(async (command) => {
        intentStatus = command.toStatus;
        return { ...intent(), status: command.toStatus };
      }),
      successfulPaymentCount: jest.fn().mockResolvedValue(1),
      markFinancialReview: jest.fn().mockResolvedValue(undefined),
      markCheckoutPaymentVerified: jest.fn().mockResolvedValue(undefined),
      assertWebhookClaimOwned: jest.fn().mockResolvedValue(undefined),
      completeWebhookClaim: jest.fn().mockResolvedValue(undefined),
      failWebhookClaim: jest.fn().mockResolvedValue(undefined),
      createWebhookEvidence: jest.fn(),
      findWebhook: jest.fn(),
    };
    const bold = {
      parseWebhook: jest.fn().mockReturnValue(parsed),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };
    const gate = { assertEnabled: jest.fn().mockResolvedValue(undefined) };
    const kitchen = { evaluateAndMark: jest.fn().mockResolvedValue(undefined) };
    const service = new CanonicalPaymentWebhookService(
      repository as never,
      bold as never,
      gate as never,
      kitchen as never,
    );
    const command = {
      rawPayload: {},
      rawBody,
      headers: { 'x-bold-merchant-id': 'merchant-1' },
    };
    return { service, repository, kitchen, command };
  }

  it('recovers after the payment transition commits without applying it twice', async () => {
    const { service, repository, kitchen, command } = harness();
    repository.markCheckoutPaymentVerified.mockRejectedValueOnce(new Error('fault after transition'));
    repository.claimWebhookEvidence
      .mockResolvedValueOnce({
        state: 'CLAIMED',
        webhookId: 'webhook-1',
        paymentIntentId: 'intent-1',
        transitionApplied: false,
        attempt: 1,
      })
      .mockResolvedValueOnce({
        state: 'CLAIMED',
        webhookId: 'webhook-1',
        paymentIntentId: 'intent-1',
        transitionApplied: true,
        attempt: 2,
      });

    await expect(service.processBold(command)).rejects.toThrow('fault after transition');
    await expect(service.processBold(command)).resolves.toMatchObject({
      processedStatus: 'PROCESSED',
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    });

    expect(repository.transitionPayment).toHaveBeenCalledTimes(1);
    expect(repository.failWebhookClaim).toHaveBeenCalledWith(expect.objectContaining({
      webhookId: 'webhook-1',
      errorCode: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
      retryable: true,
    }));
    expect(repository.completeWebhookClaim).toHaveBeenCalledTimes(1);
    expect(kitchen.evaluateAndMark).toHaveBeenCalledTimes(1);
  });

  it('returns deterministic replay without re-entering financial processing', async () => {
    const { service, repository, kitchen, command } = harness();
    repository.claimWebhookEvidence.mockResolvedValue({
      state: 'REPLAY',
      webhookId: 'webhook-1',
      result: {
        processedStatus: 'PROCESSED',
        paymentIntentId: 'intent-1',
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
      },
    });

    await expect(service.processBold(command)).resolves.toEqual({
      processedStatus: 'DUPLICATE_REPLAY',
      paymentIntentId: 'intent-1',
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    });
    expect(repository.transitionPayment).not.toHaveBeenCalled();
    expect(repository.completeWebhookClaim).not.toHaveBeenCalled();
    expect(kitchen.evaluateAndMark).not.toHaveBeenCalled();
  });

  it('does not acknowledge a duplicate while its processing lease is active', async () => {
    const { service, repository, command } = harness();
    repository.claimWebhookEvidence.mockResolvedValue({
      state: 'ACTIVE',
      webhookId: 'webhook-1',
      paymentIntentId: 'intent-1',
    });

    await expect(service.processBold(command)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_WEBHOOK_PROCESSING_ACTIVE' }),
      status: 503,
    });
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });

  it('routes financial UNKNOWN_RESULT to review without blind success recovery', async () => {
    const { service, repository, kitchen, command } = harness(PaymentIntentStatus.UNKNOWN_RESULT);

    await expect(service.processBold(command)).resolves.toMatchObject({
      processedStatus: 'FINANCIAL_REVIEW_REQUIRED',
      paymentStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
    });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
      reasonCode: 'WEBHOOK_AFTER_UNKNOWN_RESULT_REQUIRES_REVIEW',
    }));
    expect(repository.transitionPayment).not.toHaveBeenCalledWith(expect.objectContaining({
      toStatus: PaymentIntentStatus.SUCCEEDED,
    }));
    expect(kitchen.evaluateAndMark).not.toHaveBeenCalled();
  });

  it('fails closed on a provider event identity collision', async () => {
    const { service, repository, command } = harness();
    repository.claimWebhookEvidence.mockResolvedValue({ state: 'IDENTITY_CONFLICT', webhookId: 'webhook-1' });

    await expect(service.processBold(command)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_WEBHOOK_IDENTITY_CONFLICT' }),
    });
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });
});
