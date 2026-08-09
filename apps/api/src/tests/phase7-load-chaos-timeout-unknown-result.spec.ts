import {
  NotificationIntentStatus,
  PaymentIntentProvider,
  PaymentIntentStatus,
  SofiaCommandFailureClass,
  SofiaCommandStatus,
} from '@prisma/client';
import { NotificationIntentConsumerService } from '../modules/notifications/notification-intent-consumer.service';
import { PrismaNotificationReconciliationObserver } from '../modules/notifications/notification-reconciliation-observer';
import { PaymentOrchestrationService } from '../modules/order-checkout/payment-orchestration.service';
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';

const RETRY_BURST_SIZE = 32;
const expiresAt = new Date('2099-01-01T00:00:00.000Z');

function paymentIntent(status: PaymentIntentStatus) {
  const checkout = {
    id: 'phase7-checkout-1',
    fulfillment: 'TAKEAWAY',
    paymentPreference: 'ONLINE',
    total: { toString: () => '25000' },
    customerSnapshot: {},
  };
  return {
    id: 'phase7-intent-1',
    checkoutId: checkout.id,
    attemptNumber: 1,
    provider: PaymentIntentProvider.BOLD,
    status,
    amount: { toString: () => '25000' },
    currency: 'COP',
    providerPaymentId: null,
    providerReference: null,
    expiresAt,
    version: status === PaymentIntentStatus.UNKNOWN_RESULT ? 3 : 2,
    checkout,
  };
}

describe('Phase 7 timeout unknown-result safety', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('turns one real Bold adapter timeout into terminal UNKNOWN_RESULT and blocks the retry burst', async () => {
    jest.useFakeTimers();
    process.env.BOLD_API_KEY = 'phase7-test-only-key';
    process.env.BOLD_WEBHOOK_SECRET = 'phase7-test-only-webhook-secret';
    process.env.BOLD_BASE_URL = 'https://bold.invalid';
    process.env.BOLD_TIMEOUT_MS = '5';
    let status: PaymentIntentStatus = PaymentIntentStatus.LINK_READY;
    const repository = {
      findPaymentLinkById: jest.fn(async () => ({
        id: 'phase7-link-1',
        expiresAt,
        revokedAt: null,
        status: 'ACTIVE',
        paymentIntent: paymentIntent(status),
      })),
      beginProviderPayment: jest.fn(async () => {
        status = PaymentIntentStatus.PENDING;
        return { started: true, paymentIntent: paymentIntent(status) };
      }),
      markProviderPaymentUnknown: jest.fn(async () => {
        status = PaymentIntentStatus.UNKNOWN_RESULT;
        return { marked: true, paymentIntent: paymentIntent(status) };
      }),
      bindProviderPaymentResult: jest.fn(),
      markPaymentLinkOpened: jest.fn(),
    };
    const fetchMock = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('synthetic Bold timeout');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new PaymentOrchestrationService(
      repository as never,
      { assertPaymentCombination: jest.fn() } as never,
      { assertEnabled: jest.fn().mockResolvedValue(undefined) } as never,
      new BoldPaymentProvider(),
      { log: jest.fn() } as never,
      { verify: jest.fn().mockReturnValue({ linkId: 'phase7-link-1', expiresAt }) } as never,
    );

    const firstAttempt = expect(service.startBoldPayment('phase7-public-reference')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_UNKNOWN_RESULT' }),
    });
    await jest.advanceTimersByTimeAsync(5);
    await firstAttempt;

    const retries = await Promise.allSettled(
      Array.from({ length: RETRY_BURST_SIZE }, () => service.startBoldPayment('phase7-public-reference')),
    );

    expect(retries).toHaveLength(RETRY_BURST_SIZE);
    expect(retries.every((result) => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(repository.beginProviderPayment).toHaveBeenCalledTimes(1);
    expect(repository.beginProviderPayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentIntentId: 'phase7-intent-1',
      idempotencyKey: 'phase7-intent-1:provider-requested',
    }));
    expect(repository.markProviderPaymentUnknown).toHaveBeenCalledTimes(1);
    expect(repository.markProviderPaymentUnknown).toHaveBeenCalledWith(expect.objectContaining({
      paymentIntentId: 'phase7-intent-1',
      idempotencyKey: 'phase7-intent-1:unknown-result',
    }));
    expect(repository.bindProviderPaymentResult).not.toHaveBeenCalled();
    expect(repository.markPaymentLinkOpened).not.toHaveBeenCalled();
  });

  it('observes WhatsApp timeout evidence as unknown and suppresses every automatic retry', async () => {
    const prisma = {
      sofiaCommand: {
        findUnique: jest.fn().mockResolvedValue({
          status: SofiaCommandStatus.FAILED,
          failureClass: SofiaCommandFailureClass.UNKNOWN_RESULT,
          failureCode: 'PROVIDER_TIMEOUT',
        }),
      },
      whatsappOutboundMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'outbound-1',
          status: 'UNKNOWN_RESULT',
          unknownResult: true,
          providerMessageId: null,
          secureCommandId: 'command-1',
        }),
      },
    };
    const observer = new PrismaNotificationReconciliationObserver(prisma as never);
    const candidate = {
      id: 'notification-1',
      status: NotificationIntentStatus.UNKNOWN_RESULT,
      version: 4,
      attempts: 1,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    } as const;
    const outbox = {
      claim: jest.fn().mockResolvedValue({ state: 'UNKNOWN_RESULT', intent: null }),
    };
    const materializer = { materialize: jest.fn() };
    const commands = { receive: jest.fn() };
    const consumer = new NotificationIntentConsumerService(
      outbox as never,
      { evaluate: jest.fn() } as never,
      materializer as never,
      commands as never,
    );

    const evidence = await Promise.all(
      Array.from({ length: RETRY_BURST_SIZE }, () => observer.observe(candidate)),
    );
    const retries = await Promise.all(
      Array.from({ length: RETRY_BURST_SIZE }, (_, index) =>
        consumer.consume('notification-1', `worker-${index}`, new Date('2026-08-09T12:00:00.000Z')),
      ),
    );

    expect(evidence).toEqual(Array.from({ length: RETRY_BURST_SIZE }, () => ({
      observation: 'RESULT_UNKNOWN',
      errorCode: 'WHATSAPP_UNKNOWN_RESULT',
    })));
    expect(retries.every((result) =>
      result.state === 'SKIPPED' && result.reasonCode === 'NOTIFICATION_UNKNOWN_RESULT')).toBe(true);
    expect(materializer.materialize).not.toHaveBeenCalled();
    expect(commands.receive).not.toHaveBeenCalled();
  });
});
