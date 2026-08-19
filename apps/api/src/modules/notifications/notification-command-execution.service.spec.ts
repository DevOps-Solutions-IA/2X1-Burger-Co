import { NotificationIntentStatus } from '@prisma/client';
import { NotificationCommandExecutionService } from './notification-command-execution.service';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

const now = new Date('2026-08-15T09:00:00.000Z');

function candidate(overrides: Partial<NotificationReconciliationCandidate> = {}): NotificationReconciliationCandidate {
  return {
    id: 'notification-1',
    status: NotificationIntentStatus.COMMAND_PENDING,
    version: 3,
    attempts: 1,
    secureCommandId: 'command-1',
    outboundMessageId: 'outbound-1',
    ...overrides,
  };
}

function harness() {
  const outbox = {
    markDispatched: jest.fn(),
    reconcile: jest.fn(),
  };
  const execution = { execute: jest.fn() };
  return {
    service: new NotificationCommandExecutionService(outbox as never, execution as never),
    outbox,
    execution,
  };
}

describe('NotificationCommandExecutionService', () => {
  it('is the only place that invokes SecureCommand execute() for a COMMAND_PENDING intent', async () => {
    const { service, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'DISPATCHED', replayed: false });

    await service.dispatch(candidate(), now);

    expect(execution.execute).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      secureCommandId: 'command-1',
    });
  });

  it('marks the intent DISPATCHED (waking the existing reconciliation stage) on a fresh execute()', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'DISPATCHED', replayed: false });

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'DISPATCHED',
      reasonCode: 'SECURE_COMMAND_EXECUTED',
    });
    expect(outbox.markDispatched).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 3,
      outboundMessageId: 'outbound-1',
    });
    expect(outbox.reconcile).not.toHaveBeenCalled();
  });

  it('marks DISPATCHED with a replay reason when the SecureCommand result is replayed', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'DISPATCHED', replayed: true });

    await expect(service.dispatch(candidate(), now)).resolves.toMatchObject({
      state: 'DISPATCHED',
      reasonCode: 'SECURE_COMMAND_RESULT_REPLAYED',
    });
    expect(outbox.markDispatched).toHaveBeenCalledTimes(1);
  });

  it('reconciles to FAILED (terminal) through the existing audited path when execute() is policy/approval blocked', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({
      status: 'BLOCKED',
      observation: 'COMMAND_REJECTED',
      errorCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
    });

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'FAILED',
      reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
    });
    expect(outbox.reconcile).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 3,
      currentStatus: 'COMMAND_PENDING',
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      observation: 'COMMAND_REJECTED',
      errorCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      now,
    });
    expect(outbox.markDispatched).not.toHaveBeenCalled();
  });

  it('reconciles to UNKNOWN_RESULT (never assumed FAILED or resent) when the execute() outcome is genuinely unknown', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({
      status: 'BLOCKED',
      observation: 'RESULT_UNKNOWN',
      errorCode: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE',
    });

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'UNKNOWN_RESULT',
      reasonCode: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE',
    });
    expect(outbox.reconcile).toHaveBeenCalledWith(expect.objectContaining({ observation: 'RESULT_UNKNOWN' }));
  });

  it('skips without mutating state when another worker is already executing the same command (duplicate worker claim)', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'RUNNING' });

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'SKIPPED',
      reasonCode: 'SOFIA_COMMAND_ALREADY_RUNNING',
    });
    expect(outbox.markDispatched).not.toHaveBeenCalled();
    expect(outbox.reconcile).not.toHaveBeenCalled();
  });

  it('swallows a lost optimistic-concurrency race on markDispatched as a benign duplicate worker claim', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'DISPATCHED', replayed: false });
    outbox.markDispatched.mockRejectedValue(new Error('STALE_NOTIFICATION_INTENT_VERSION'));

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_VERSION_CONFLICT',
    });
  });

  it('swallows a lost optimistic-concurrency race on reconcile as a benign duplicate worker claim', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({
      status: 'BLOCKED',
      observation: 'COMMAND_REJECTED',
      errorCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
    });
    outbox.reconcile.mockRejectedValue(new Error('STALE_NOTIFICATION_INTENT_VERSION'));

    await expect(service.dispatch(candidate(), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_VERSION_CONFLICT',
    });
  });

  it('propagates an unrecognized persistence failure instead of masking it', async () => {
    const { service, outbox, execution } = harness();
    execution.execute.mockResolvedValue({ status: 'DISPATCHED', replayed: false });
    outbox.markDispatched.mockRejectedValue(new Error('NOTIFICATION_DATABASE_UNAVAILABLE'));

    await expect(service.dispatch(candidate(), now)).rejects.toThrow('NOTIFICATION_DATABASE_UNAVAILABLE');
  });

  it('never calls execute() for a candidate that is not COMMAND_PENDING', async () => {
    const { service, execution } = harness();

    await expect(service.dispatch(candidate({ status: NotificationIntentStatus.DISPATCHED }), now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_DISPATCH_NOT_APPLICABLE',
    });
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('never calls execute() when the COMMAND_PENDING candidate has no bound secure command (data integrity guard)', async () => {
    const { service, execution } = harness();

    await expect(service.dispatch(candidate({ secureCommandId: null }), now)).resolves.toMatchObject({
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_DISPATCH_NOT_APPLICABLE',
    });
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('never calls execute() when the COMMAND_PENDING candidate has no bound outbound message (data integrity guard)', async () => {
    const { service, execution } = harness();

    await expect(service.dispatch(candidate({ outboundMessageId: null }), now)).resolves.toMatchObject({
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_DISPATCH_NOT_APPLICABLE',
    });
    expect(execution.execute).not.toHaveBeenCalled();
  });
});
