import { PaymentWebhookRecoveryWorker } from './payment-webhook-recovery.worker';

describe('PaymentWebhookRecoveryWorker', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED = originalEnabled;
    jest.restoreAllMocks();
  });

  it('runs one supervised cycle at a time', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const webhooks = {
      recoverPendingBatch: jest.fn().mockImplementation(async () => pending),
    };
    const worker = new PaymentWebhookRecoveryWorker(webhooks as never);

    const first = worker.runOnce(new Date('2026-08-09T00:00:00.000Z'));
    const second = worker.runOnce(new Date('2026-08-09T00:00:01.000Z'));
    expect(webhooks.recoverPendingBatch).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  it('remains disabled in production unless explicitly activated', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED = 'false';
    const webhooks = { recoverPendingBatch: jest.fn() };
    const worker = new PaymentWebhookRecoveryWorker(webhooks as never);

    worker.onModuleInit();
    expect(webhooks.recoverPendingBatch).not.toHaveBeenCalled();
  });

  it('can be explicitly activated for controlled production recovery', async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED = 'true';
    const webhooks = { recoverPendingBatch: jest.fn().mockResolvedValue({ completed: 0 }) };
    const worker = new PaymentWebhookRecoveryWorker(webhooks as never);

    worker.onModuleInit();
    await jest.runOnlyPendingTimersAsync();
    expect(webhooks.recoverPendingBatch).toHaveBeenCalledTimes(1);
    await worker.onApplicationShutdown();
    jest.useRealTimers();
  });
});
