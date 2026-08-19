import { PaymentIntentStatus } from '@prisma/client';
import { PaymentExpirationWorker } from './payment-expiration.worker';

function repositoryStub(overrides: Record<string, jest.Mock> = {}) {
  return {
    findExpirablePaymentIntentIds: jest.fn().mockResolvedValue([]),
    expireStalePaymentLinks: jest.fn().mockResolvedValue(0),
    findExpirableCheckoutIds: jest.fn().mockResolvedValue([]),
    findPaymentIntent: jest.fn(),
    transitionPayment: jest.fn(),
    expireCheckoutPaymentPending: jest.fn(),
    findCheckout: jest.fn(),
    ...overrides,
  };
}

function gateStub(overrides: Record<string, jest.Mock> = {}) {
  return { assertEnabled: jest.fn().mockResolvedValue(undefined), ...overrides };
}

describe('PaymentExpirationWorker', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.PAYMENT_EXPIRATION_WORKER_ENABLED;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.PAYMENT_EXPIRATION_WORKER_ENABLED = originalEnabled;
    jest.restoreAllMocks();
  });

  it('runs one supervised cycle at a time', async () => {
    let finish!: () => void;
    const pending = new Promise<string[]>((resolve) => {
      finish = () => resolve([]);
    });
    const repository = repositoryStub({ findExpirablePaymentIntentIds: jest.fn().mockImplementation(() => pending) });
    const worker = new PaymentExpirationWorker(repository as never, gateStub() as never);

    const first = worker.runOnce(new Date('2026-08-09T00:00:00.000Z'));
    const second = worker.runOnce(new Date('2026-08-09T00:00:01.000Z'));
    // Flush the microtask queue past the `await this.gate.assertEnabled(...)` that precedes the
    // repository call inside the cycle, without resolving `pending` itself.
    await Promise.resolve();
    await Promise.resolve();
    expect(repository.findExpirablePaymentIntentIds).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  it('remains disabled in production unless explicitly activated', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_EXPIRATION_WORKER_ENABLED = 'false';
    const gate = gateStub();
    const worker = new PaymentExpirationWorker(repositoryStub() as never, gate as never);

    worker.onModuleInit();
    expect(gate.assertEnabled).not.toHaveBeenCalled();
  });

  it('can be explicitly activated for controlled production recovery', async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_EXPIRATION_WORKER_ENABLED = 'true';
    const gate = gateStub();
    const worker = new PaymentExpirationWorker(repositoryStub() as never, gate as never);

    worker.onModuleInit();
    await jest.runOnlyPendingTimersAsync();
    expect(gate.assertEnabled).toHaveBeenCalledWith('PAYMENT_ORCHESTRATION');
    await worker.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('uses the same numeric boolean representation accepted by startup validation', async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_EXPIRATION_WORKER_ENABLED = '1';
    const gate = gateStub();
    const worker = new PaymentExpirationWorker(repositoryStub() as never, gate as never);

    worker.onModuleInit();
    await jest.runOnlyPendingTimersAsync();
    expect(gate.assertEnabled).toHaveBeenCalledTimes(1);
    await worker.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('respects Phase5RuntimeGate: a disabled capability aborts the whole cycle before any mutation', async () => {
    const repository = repositoryStub();
    const gate = gateStub({ assertEnabled: jest.fn().mockRejectedValue(new Error('CHECKOUT_OPERATION_DISABLED')) });
    const worker = new PaymentExpirationWorker(repository as never, gate as never);

    await expect(worker.runOnce()).rejects.toThrow('CHECKOUT_OPERATION_DISABLED');
    expect(repository.findExpirablePaymentIntentIds).not.toHaveBeenCalled();
    expect(repository.expireStalePaymentLinks).not.toHaveBeenCalled();
    expect(repository.findExpirableCheckoutIds).not.toHaveBeenCalled();
  });

  it('expires each candidate intent via the version-guarded transition and tolerates a lost race', async () => {
    const repository = repositoryStub({
      findExpirablePaymentIntentIds: jest.fn().mockResolvedValue(['intent-a', 'intent-b']),
      findPaymentIntent: jest.fn()
        .mockResolvedValueOnce({ id: 'intent-a', version: 3, status: PaymentIntentStatus.LINK_READY })
        .mockResolvedValueOnce({ id: 'intent-b', version: 1, status: PaymentIntentStatus.CREATED }),
      transitionPayment: jest.fn()
        .mockResolvedValueOnce({ id: 'intent-a', status: PaymentIntentStatus.EXPIRED })
        .mockRejectedValueOnce(new Error('PAYMENT_INTENT_CONFLICT')),
    });
    const worker = new PaymentExpirationWorker(repository as never, gateStub() as never);

    const result = await worker.runOnce(new Date('2026-08-09T00:00:00.000Z'));

    expect(result.intentsExpired).toBe(1);
    expect(repository.transitionPayment).toHaveBeenNthCalledWith(1, expect.objectContaining({
      paymentIntentId: 'intent-a',
      expectedVersion: 3,
      toStatus: PaymentIntentStatus.EXPIRED,
      reasonCode: 'PAYMENT_INTENT_TTL_ELAPSED',
      idempotencyKey: 'intent-a:expired',
    }));
    expect(repository.transitionPayment).toHaveBeenNthCalledWith(2, expect.objectContaining({ paymentIntentId: 'intent-b' }));
  });

  it('skips an intent that already resolved to a non-active status before the sweep reached it', async () => {
    const repository = repositoryStub({
      findExpirablePaymentIntentIds: jest.fn().mockResolvedValue(['intent-a']),
      findPaymentIntent: jest.fn().mockResolvedValue({ id: 'intent-a', version: 5, status: PaymentIntentStatus.SUCCEEDED }),
    });
    const worker = new PaymentExpirationWorker(repository as never, gateStub() as never);

    const result = await worker.runOnce();

    expect(result.intentsExpired).toBe(0);
    expect(repository.transitionPayment).not.toHaveBeenCalled();
  });

  it('cascades a successfully expired checkout into expiring its still-open latest intent', async () => {
    const repository = repositoryStub({
      findExpirableCheckoutIds: jest.fn().mockResolvedValue(['checkout-a']),
      expireCheckoutPaymentPending: jest.fn().mockResolvedValue({ id: 'checkout-a', status: 'EXPIRED' }),
      findCheckout: jest.fn().mockResolvedValue({
        id: 'checkout-a',
        paymentIntents: [{ id: 'intent-open', version: 2, status: PaymentIntentStatus.PENDING }],
      }),
      findPaymentIntent: jest.fn().mockResolvedValue({ id: 'intent-open', version: 2, status: PaymentIntentStatus.PENDING }),
      transitionPayment: jest.fn().mockResolvedValue({ id: 'intent-open', status: PaymentIntentStatus.EXPIRED }),
    });
    const worker = new PaymentExpirationWorker(repository as never, gateStub() as never);

    const result = await worker.runOnce();

    expect(result.checkoutsExpired).toBe(1);
    expect(repository.expireCheckoutPaymentPending).toHaveBeenCalledWith('checkout-a');
    expect(repository.transitionPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'intent-open', toStatus: PaymentIntentStatus.EXPIRED }));
  });

  it('does not cascade when the checkout expiry itself did not apply (already moved on concurrently)', async () => {
    const repository = repositoryStub({
      findExpirableCheckoutIds: jest.fn().mockResolvedValue(['checkout-a']),
      expireCheckoutPaymentPending: jest.fn().mockRejectedValue(new Error('CHECKOUT_NOT_PAYABLE')),
    });
    const worker = new PaymentExpirationWorker(repository as never, gateStub() as never);

    const result = await worker.runOnce();

    expect(result.checkoutsExpired).toBe(0);
    expect(repository.findCheckout).not.toHaveBeenCalled();
  });
});
