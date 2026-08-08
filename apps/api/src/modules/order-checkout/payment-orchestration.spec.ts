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

  function harness(status: PaymentIntentStatus = PaymentIntentStatus.LINK_READY) {
    const paymentIntent = { ...intent, status };
    const linkExpiry = new Date(Date.now() + 60_000);
    const repository = {
      findPaymentLinkById: jest.fn().mockResolvedValue({
        id: 'link-1',
        expiresAt: linkExpiry,
        revokedAt: null,
        status: 'ACTIVE',
        paymentIntent,
      }),
      transitionPayment: jest.fn().mockResolvedValue({ ...paymentIntent, status: PaymentIntentStatus.UNKNOWN_RESULT }),
      markPaymentLinkOpened: jest.fn(),
    };
    const bold = { createPayment: jest.fn().mockRejectedValue(new Error('provider timeout')) };
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
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: PaymentIntentStatus.UNKNOWN_RESULT,
      reasonCode: 'BOLD_CREATE_UNKNOWN_RESULT',
    }));
  });

  it('never retries a persisted unknown provider result', async () => {
    const { service, repository, bold } = harness(PaymentIntentStatus.UNKNOWN_RESULT);
    await expect(service.startBoldPayment('public-token')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    expect(bold.createPayment).not.toHaveBeenCalled();
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });
});
