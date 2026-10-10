import { Logger } from '@nestjs/common';
import { NotificationIntentStatus } from '@prisma/client';
import { NotificationOutboxWorker } from './notification-outbox.worker';

const now = new Date('2026-08-09T12:00:00.000Z');

function harness(enabled = false) {
  const consumer = {
    drainOnce: jest.fn().mockResolvedValue([]),
    reconcile: jest.fn().mockResolvedValue(undefined),
  };
  const outbox = {
    findReconciliationCandidates: jest.fn().mockResolvedValue([]),
    sweepMaintenance: jest.fn().mockResolvedValue([]),
  };
  const observer = { observe: jest.fn() };
  const executor = { dispatch: jest.fn().mockResolvedValue(undefined) };
  return {
    worker: new NotificationOutboxWorker(
      { get: jest.fn().mockReturnValue(enabled) } as never,
      consumer as never,
      outbox as never,
      observer as never,
      executor as never,
    ),
    consumer,
    outbox,
    observer,
    executor,
  };
}

describe('NotificationOutboxWorker', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs bounded claim, dispatch and maintenance batches, routing a COMMAND_PENDING candidate to the dispatch stage only', async () => {
    const { worker, consumer, outbox, observer, executor } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-1',
      status: NotificationIntentStatus.COMMAND_PENDING,
      version: 2,
      attempts: 1,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    }]);

    await worker.runOnce(now);

    expect(consumer.drainOnce).toHaveBeenCalledWith(expect.any(String), now, 25);
    expect(outbox.findReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(outbox.findReconciliationCandidates).toHaveBeenCalledWith(now, 25, false);

    // COMMAND_PENDING candidate goes through the dispatch stage (execute()), never through
    // observe()/reconcile() -- that stage only ever reads already-settled evidence.
    expect(executor.dispatch).toHaveBeenCalledTimes(1);
    expect(executor.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notification-1', status: NotificationIntentStatus.COMMAND_PENDING }),
      now,
    );
    expect(observer.observe).not.toHaveBeenCalled();
    expect(consumer.reconcile).not.toHaveBeenCalled();

    expect(outbox.sweepMaintenance).toHaveBeenCalledWith(now, 25);
  });

  it('routes a DISPATCHED candidate to the existing observe()/reconcile() reconciliation stage, never to the dispatch stage', async () => {
    const { worker, consumer, outbox, observer, executor } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-2',
      status: NotificationIntentStatus.DISPATCHED,
      version: 4,
      attempts: 1,
      secureCommandId: 'command-2',
      outboundMessageId: 'outbound-2',
    }]);
    observer.observe.mockResolvedValue({ observation: 'OUTBOUND_SUCCEEDED', errorCode: null });

    await worker.runOnce(now);

    expect(observer.observe).toHaveBeenCalledWith(expect.objectContaining({ id: 'notification-2' }));
    expect(consumer.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      notificationIntentId: 'notification-2',
      observation: 'OUTBOUND_SUCCEEDED',
    }));
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(outbox.sweepMaintenance).toHaveBeenCalledWith(now, 25);
  });

  it('persists UNKNOWN_RESULT reconciliation for an already-dispatched candidate without resending', async () => {
    const { worker, consumer, outbox, observer } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-1',
      status: NotificationIntentStatus.DISPATCHED,
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

  it('R2 regression guardian: a COMMAND_PENDING candidate deferred by the dispatch stage still runs through the same maintenance sweep every cycle, never a special-cased hot loop', async () => {
    const { worker, outbox, executor } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-1',
      status: NotificationIntentStatus.COMMAND_PENDING,
      version: 2,
      attempts: 1,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    }]);
    // Simulates what NotificationCommandExecutionService.dispatch() now does (see its own spec)
    // for an unresolved outcome (still-open approval window or a concurrent claim): it defers
    // through outbox.reconcile()'s DEFER branch rather than failing or skipping silently. At the
    // worker level, the only observable contract is that this candidate is still routed through
    // the dispatch stage, and maintenance still runs unconditionally every cycle regardless of
    // the dispatch outcome -- the bounded settlement itself (attempts/nextRetryAt/eventual
    // UNKNOWN_RESULT) is asserted directly against outbox.reconcile in
    // notification-command-execution.service.spec.ts.
    executor.dispatch.mockResolvedValue({ notificationIntentId: 'notification-1', state: 'DEFERRED', reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED' });

    await worker.runOnce(now);
    await worker.runOnce(new Date(now.getTime() + 1_000));

    expect(executor.dispatch).toHaveBeenCalledTimes(2);
    expect(outbox.sweepMaintenance).toHaveBeenCalledTimes(2);
  });

  it('skips a COMMAND_PENDING candidate with no bound secure command in both stages', async () => {
    const { worker, consumer, observer, executor, outbox } = harness();
    outbox.findReconciliationCandidates.mockResolvedValue([{
      id: 'notification-orphan',
      status: NotificationIntentStatus.COMMAND_PENDING,
      version: 1,
      attempts: 1,
      secureCommandId: null,
      outboundMessageId: null,
    }]);

    await worker.runOnce(now);

    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(consumer.reconcile).not.toHaveBeenCalled();
  });

  it('isolates a dispatch-candidate failure without blocking reconciliation or maintenance', async () => {
    const { worker, consumer, outbox, observer, executor } = harness();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    outbox.findReconciliationCandidates.mockResolvedValue([
      {
        id: 'notification-1',
        status: NotificationIntentStatus.COMMAND_PENDING,
        version: 2,
        attempts: 1,
        secureCommandId: 'command-1',
        outboundMessageId: 'outbound-1',
      },
      {
        id: 'notification-2',
        status: NotificationIntentStatus.DISPATCHED,
        version: 1,
        attempts: 1,
        secureCommandId: 'command-2',
        outboundMessageId: 'outbound-2',
      },
    ]);
    executor.dispatch.mockRejectedValue(new Error('SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE'));
    observer.observe.mockResolvedValue({ observation: 'OUTBOUND_SUCCEEDED', errorCode: null });

    await worker.runOnce(now);

    expect(errorLog).toHaveBeenCalledWith('NOTIFICATION_DISPATCH_CANDIDATE_FAILED');
    expect(consumer.reconcile).toHaveBeenCalledWith(expect.objectContaining({ notificationIntentId: 'notification-2' }));
    expect(outbox.sweepMaintenance).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
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

  it('continues dispatch, reconciliation and lease maintenance after a failed claim stage', async () => {
    const { worker, consumer, outbox } = harness();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    consumer.drainOnce.mockRejectedValue(new Error('database unavailable'));

    await worker.runOnce(now);

    expect(outbox.findReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(outbox.sweepMaintenance).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('NOTIFICATION_CLAIM_STAGE_FAILED');
    errorLog.mockRestore();
  });

  it('continues the cycle with an empty candidate batch when fetching candidates fails', async () => {
    const { worker, outbox, executor, observer } = harness();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    outbox.findReconciliationCandidates.mockRejectedValue(new Error('database unavailable'));

    await worker.runOnce(now);

    expect(errorLog).toHaveBeenCalledWith('NOTIFICATION_RECONCILIATION_CANDIDATES_FAILED');
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
    expect(outbox.sweepMaintenance).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('starts only when enabled and stops scheduling after shutdown', async () => {
    jest.useFakeTimers();
    const { worker, consumer } = harness(true);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);

    await worker.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(consumer.drainOnce).toHaveBeenCalledTimes(1);
  });

  it('fails closed in production when the validated flag is absent', async () => {
    jest.useFakeTimers();
    const consumer = { drainOnce: jest.fn() };
    const worker = new NotificationOutboxWorker(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      consumer as never,
      {} as never,
      {} as never,
      {} as never,
    );

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(2_000);

    expect(consumer.drainOnce).not.toHaveBeenCalled();
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
