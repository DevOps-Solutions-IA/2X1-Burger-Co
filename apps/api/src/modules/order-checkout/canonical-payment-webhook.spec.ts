import { PaymentIntentProvider, PaymentIntentStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';

const parsed = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt-1',
  eventType: 'PAYMENT',
  providerPaymentId: 'provider-payment-1',
  providerReference: 'checkout-1',
  orderReference: 'checkout-1',
  status: 'APPROVED' as const,
  amount: 30000,
  currency: 'COP',
  rawPayload: { eventId: 'evt-1', status: 'APPROVED' },
  ...overrides,
});

describe('CanonicalPaymentWebhookService', () => {
  const rawBody = Buffer.from('{"id":"evt-1"}');
  const accountHash = createHash('sha256').update('merchant-1').digest('hex');

  function harness(input: { signature?: boolean; parsed?: ReturnType<typeof parsed>; existingWebhook?: unknown } = {}) {
    const intent = {
      id: 'intent-1',
      checkoutId: 'checkout-1',
      provider: PaymentIntentProvider.BOLD,
      status: PaymentIntentStatus.PENDING,
      amount: { toString: () => '30000' },
      currency: 'COP',
      providerAccountHash: accountHash,
      version: 2,
      checkout: { status: 'PAYMENT_PENDING' },
    };
    const repository = {
      createWebhookEvidence: jest.fn().mockResolvedValue({ id: 'webhook-1', paymentIntentId: intent.id }),
      findWebhook: jest.fn().mockResolvedValue(input.existingWebhook ?? null),
      findIntentByProvider: jest.fn().mockResolvedValue(intent),
      transitionPayment: jest.fn().mockImplementation(async (command) => ({ ...intent, status: command.toStatus, version: 3 })),
      successfulPaymentCount: jest.fn().mockResolvedValue(1),
      markFinancialReview: jest.fn(),
      markCheckoutPaymentVerified: jest.fn(),
    };
    const bold = {
      parseWebhook: jest.fn().mockReturnValue(input.parsed ?? parsed()),
      verifyWebhookSignature: jest.fn().mockReturnValue(input.signature ?? true),
    };
    const gate = { assertEnabled: jest.fn().mockResolvedValue(undefined) };
    const kitchen = { evaluateAndMark: jest.fn().mockResolvedValue(undefined) };
    return { service: new CanonicalPaymentWebhookService(repository as never, bold as never, gate as never, kitchen as never), repository, kitchen };
  }

  it('accepts only a signed exact amount/currency/account event as succeeded', async () => {
    const { service, repository, kitchen } = harness();
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ processedStatus: 'PROCESSED', paymentStatus: 'SUCCEEDED' });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({ toStatus: PaymentIntentStatus.SUCCEEDED, reasonCode: 'BOLD_PAYMENT_VERIFIED' }));
    expect(repository.markCheckoutPaymentVerified).toHaveBeenCalledWith('checkout-1');
    expect(kitchen.evaluateAndMark).toHaveBeenCalledWith('checkout-1', null);
  });

  it.each([
    [parsed({ amount: 29999 }), 'AMOUNT_MISMATCH'],
    [parsed({ currency: 'USD' }), 'CURRENCY_MISMATCH'],
  ])('fails closed for financial mismatch %#', async (providerEvent, processedStatus) => {
    const { service, repository } = harness({ parsed: providerEvent });
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ processedStatus });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({ toStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED }));
  });

  it('rejects a wrong provider account and preserves review evidence', async () => {
    const { service, repository } = harness();
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'stolen-account' } })).resolves.toMatchObject({ processedStatus: 'ACCOUNT_MISMATCH' });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({ toStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED }));
  });

  it('does not reserve an event id or mutate payment truth for an invalid signature', async () => {
    const { service, repository } = harness({ signature: false });
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: {} })).resolves.toMatchObject({ processedStatus: 'SIGNATURE_INVALID' });
    expect(repository.createWebhookEvidence).toHaveBeenCalledWith(expect.objectContaining({ eventId: null, signatureValid: false }));
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });

  it('returns deterministic replay for a duplicate provider event', async () => {
    const { service, repository } = harness({ existingWebhook: { id: 'webhook-existing', paymentIntentId: 'intent-1' } });
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: {} })).resolves.toMatchObject({ processedStatus: 'DUPLICATE_REPLAY', paymentIntentId: 'intent-1' });
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });

  it('routes double success to financial review instead of refunding or creating another order', async () => {
    const { service, repository } = harness();
    repository.successfulPaymentCount.mockResolvedValue(2);
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ processedStatus: 'FINANCIAL_REVIEW_REQUIRED' });
    expect(repository.markFinancialReview).toHaveBeenCalledWith('checkout-1', 'MULTIPLE_SUCCESSFUL_PAYMENTS');
  });

  it('stores an unknown reference without changing financial state', async () => {
    const { service, repository, kitchen } = harness();
    repository.findIntentByProvider.mockResolvedValue(null);
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ processedStatus: 'REFERENCE_UNKNOWN' });
    expect(repository.createWebhookEvidence).toHaveBeenCalledWith(expect.objectContaining({ processedStatus: 'REFERENCE_UNKNOWN' }));
    expect(repository.transitionPayment).not.toHaveBeenCalled();
    expect(kitchen.evaluateAndMark).not.toHaveBeenCalled();
  });

  it('records provider failure without enabling kitchen', async () => {
    const { service, repository, kitchen } = harness({ parsed: parsed({ status: 'FAILED' }) });
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ paymentStatus: 'FAILED' });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({ toStatus: PaymentIntentStatus.FAILED }));
    expect(kitchen.evaluateAndMark).not.toHaveBeenCalled();
  });

  it('requires financial review when success arrives after checkout cancellation', async () => {
    const { service, repository, kitchen } = harness();
    repository.findIntentByProvider.mockResolvedValue({
      id: 'intent-1',
      checkoutId: 'checkout-1',
      status: PaymentIntentStatus.PENDING,
      amount: { toString: () => '30000' },
      currency: 'COP',
      providerAccountHash: accountHash,
      version: 2,
      checkout: { status: 'CANCELLED' },
    });
    await expect(service.processBold({ rawPayload: {}, rawBody, headers: { 'x-bold-merchant-id': 'merchant-1' } })).resolves.toMatchObject({ processedStatus: 'FINANCIAL_REVIEW_REQUIRED' });
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
      reasonCode: 'PAYMENT_AFTER_CHECKOUT_TERMINAL',
    }));
    expect(kitchen.evaluateAndMark).not.toHaveBeenCalled();
  });
});
