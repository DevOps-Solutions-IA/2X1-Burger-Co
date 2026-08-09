import { Logger } from '@nestjs/common';
import { NotificationIntentStatus } from '@prisma/client';
import { NotificationOutboxWorker } from './notification-outbox.worker';

const now = new Date('2026-08-09T12:00:00.000Z');

function harness() {
  const consumer = {
    drainOnce: jest.fn().mockResolvedValue([]),
    reconcile: jest.fn().mockResolvedValue(undefined),
  };
  const outbox = {
    findReconciliationCandidates: jest.fn().mockResolvedValue([]),
    sweepMaintenance: jest.fn().mockResolvedValue([]),
  };
  const observer = { observe: jest.fn() };
  return {
    worker: new NotificationOutboxWorker(consumer as never, outbox as never, observer as never),
    consumer,
    outbox,
    observer,
  };
}

describe('NotificationOutboxWorker', () => {
  const originalEnabled = process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED;
    else process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED = originalEnabled;
    jest.useRealTimers();
  });

  it('runs bounded claim, reconciliation and maintenance batches', async () => {
    const { worker, consumer, outbox, observer } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-1',
      status: NotificationIntentStatus.COMMAND_PENDING,
      version: 2,
      attempts: 1,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    }]);
    observer.observe.mockResolvedValue({ observation: 'COMMAND_PENDING', errorCode: null });

    await worker.runOnce(now);

    expect(consumer.drainOnce).toHaveBeenCalledWith(expect.any(String), now, 25);
    expect(outbox.findReconciliationCandidates).toHaveBeenCalledWith(now, 25, false);
    expect(consumer.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      notificationIntentId: 'notification-1',
      observation: 'COMMAND_PENDING',
    }));
    expect(outbox.sweepMaintenance).toHaveBeenCalledWith(now, 25);
  });

  it('persists UNKNOWN_RESULT reconciliation without claiming or resending it', async () => {
    const { worker, consumer, outbox, observer } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-1',
      status: NotificationIntentStatus.COMMAND_PENDING,
      version: 2,
      attempts: 1,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    }]);
    observer.observe.mockResolvedValue({ observation: 'RESULT_UNKNOWN', errorCode: 'WHATSAPP_UNKNOWN_RESULT' });

    await worker.runOnce(now);

    expect(consumer.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      observation: 'RESULT_UNKNOWN',
      errorCode: 'WHATSAPP_UNKNOWN_RESULT',
    }));
    expect(outbox.findReconciliationCandidates).toHaveBeenCalledWith(now, 25, false);
  });

  it('supervises one cycle at a time when ticks overlap', async () => {
    const { worker, consumer } = harness();
    let release!: () => void;
    consumer.drainOnce.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));

    const first = worker.runOnce(now);
    const second = worker.runOnce(now);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('continues reconciliation and lease maintenance after a failed claim stage', async () => {
    const { worker, consumer, outbox } = harness();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    consumer.drainOnce.mockRejectedValue(new Error('database unavailable'));

    await worker.runOnce(now);

    expect(outbox.findReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(outbox.sweepMaintenance).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('NOTIFICATION_CLAIM_STAGE_FAILED');
    errorLog.mockRestore();
  });

  it('starts only when enabled and stops scheduling after shutdown', async () => {
    jest.useFakeTimers();
    process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED = 'true';
    const { worker, consumer } = harness();
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);

    await worker.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('waits for an active cycle during graceful shutdown', async () => {
    const { worker, consumer } = harness();
    let release!: () => void;
    consumer.drainOnce.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const cycle = worker.runOnce(now);
    let stopped = false;
    const shutdown = worker.onApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([cycle, shutdown]);
    expect(stopped).toBe(true);
  });
});
