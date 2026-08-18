import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntentStatus,
  type NotificationIntent,
} from '@prisma/client';
import { NotificationOutboxService } from './notification-outbox.service';

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: 'notification-1',
    eventType: 'ORDER_CONFIRMED',
    sourceEventId: 'event-1',
    aggregateType: 'ORDER_CHECKOUT',
    aggregateId: 'checkout-1',
    aggregateVersion: 1,
    customerId: null,
    conversationId: null,
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    factEnvelope: { total: 30_000 },
    factHash: 'a'.repeat(64),
    policyOutcome: 'ALLOWED',
    policyReason: null,
    consentVersion: 2,
    handoffVersion: 3,
    status: NotificationIntentStatus.PENDING,
    attempts: 0,
    claimOwnerHash: null,
    leaseExpiresAt: null,
    nextRetryAt: null,
    expiresAt: null,
    completedAt: null,
    lastErrorCode: null,
    outboundMessageId: null,
    secureCommandId: null,
    version: 0,
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    updatedAt: new Date('2026-08-08T12:00:00.000Z'),
    ...overrides,
  };
}

function harness() {
  const repository = {
    create: jest.fn(),
    findClaimCandidates: jest.fn(),
    findReconciliationCandidates: jest.fn(),
    findMaintenanceCandidates: jest.fn(),
    claim: jest.fn(),
    renewClaim: jest.fn(),
    markSuppressed: jest.fn(),
    markCommandPending: jest.fn(),
    markDispatched: jest.fn(),
    markSucceeded: jest.fn(),
    markUnknownResult: jest.fn(),
    markFailedAfterDispatch: jest.fn(),
    markPreDispatchFailure: jest.fn(),
    reconcile: jest.fn(),
    deferReconciliation: jest.fn(),
    settleMaintenance: jest.fn(),
  };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const service = new NotificationOutboxService(repository as never, audit as never);
  return { service, repository, audit };
}

describe('NotificationOutboxService', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const base = {
    eventType: 'ORDER_CONFIRMED',
    sourceEventId: 'event-1',
    aggregateType: 'ORDER_CHECKOUT',
    aggregateId: 'checkout-1',
    aggregateVersion: 1,
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    policyOutcome: 'ALLOWED' as const,
  };

  it('canonicalizes facts before deriving deterministic identity', async () => {
    const first = harness();
    const second = harness();
    first.repository.create.mockImplementation(async (input: { factHash: string }) => intent({ factHash: input.factHash }));
    second.repository.create.mockImplementation(async (input: { factHash: string }) => intent({ factHash: input.factHash }));

    await first.service.enqueue({ ...base, factEnvelope: { total: 30_000, items: [{ quantity: 2, product: 'Combo 2x1' }] } }, now);
    await second.service.enqueue({ ...base, factEnvelope: { items: [{ product: 'Combo 2x1', quantity: 2 }], total: 30_000 } }, now);

    expect(first.repository.create.mock.calls[0]?.[0].factHash)
      .toBe(second.repository.create.mock.calls[0]?.[0].factHash);
    expect(first.repository.create.mock.calls[0]?.[0]).toMatchObject({
      aggregateType: 'ORDER_CHECKOUT',
      sourceEventId: 'event-1',
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
    });
  });

  it('persists a policy suppression as a durable terminal intent', async () => {
    const { service, repository, audit } = harness();
    repository.create.mockResolvedValue(intent({
      id: 'notification-suppressed-1',
      policyOutcome: 'SUPPRESSED',
      policyReason: 'HUMAN_TAKEN',
      status: NotificationIntentStatus.SUPPRESSED,
      completedAt: now,
    }));

    await service.enqueue({
      ...base,
      factEnvelope: { status: 'READY_FOR_PICKUP' },
      policyOutcome: 'SUPPRESSED',
      policyReason: 'HUMAN_TAKEN',
    }, now);

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      policyOutcome: 'SUPPRESSED',
      policyReason: 'HUMAN_TAKEN',
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'notification-outbox',
      actorType: 'SYSTEM',
      action: 'NOTIFICATION_INTENT_SUPPRESSED_AT_ENQUEUE',
      module: 'notifications',
      entity: 'notification_intent',
      entityId: 'notification-suppressed-1',
      result: 'BLOCKED',
      reasonCode: 'HUMAN_TAKEN',
    }));
  });

  it('audits a successfully enqueued intent as an allowed transition', async () => {
    const { service, repository, audit } = harness();
    repository.create.mockResolvedValue(intent({ id: 'notification-allowed-1' }));

    await service.enqueue({ ...base, factEnvelope: { total: 30_000 } }, now);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_INTENT_ENQUEUED',
      module: 'notifications',
      entityId: 'notification-allowed-1',
      result: 'SUCCESS',
    }));
  });

  it.each([
    { accessToken: 'forbidden' },
    { nested: { rawPayload: { private: true } } },
    { systemPrompt: 'forbidden' },
  ])('rejects secret or internal fact keys: %p', (factEnvelope) => {
    const { service, repository } = harness();
    expect(() => service.enqueue({ ...base, factEnvelope }, now)).toThrow('NOTIFICATION_FACT_KEY_FORBIDDEN');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('hashes worker ownership and applies a bounded lease and attempt ceiling', async () => {
    const { service, repository } = harness();
    repository.claim.mockResolvedValue({ state: 'CLAIMED', intent: intent() });

    await service.claim('notification-1', 'worker-replica-1', now);

    const claim = repository.claim.mock.calls[0]?.[0];
    expect(claim).toMatchObject({
      notificationIntentId: 'notification-1',
      leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
      maxAttempts: 3,
      now,
    });
    expect(claim.claimOwnerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(claim.claimOwnerHash).not.toContain('worker-replica-1');
  });

  it('renews only the fenced claim using the same bounded owner hash', async () => {
    const { service, repository } = harness();
    repository.renewClaim.mockResolvedValue(true);

    await expect(service.renewClaim('notification-1', 4, 'worker-replica-1', now)).resolves.toBe(true);

    expect(repository.renewClaim).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 4,
      claimOwnerHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
      now,
    });
  });

  it('does not expose a retry operation for UNKNOWN_RESULT', async () => {
    const { service, repository } = harness();
    repository.markUnknownResult.mockResolvedValue(intent({ status: NotificationIntentStatus.UNKNOWN_RESULT }));

    await service.markUnknownResult('notification-1', 4, 'PROVIDER_RESULT_UNKNOWN', now);

    expect(repository.markUnknownResult).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 4,
      errorCode: 'PROVIDER_RESULT_UNKNOWN',
      now,
    });
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(service))).not.toContain('retryUnknownResult');
  });

  it('suppresses an active fenced claim with current policy evidence', async () => {
    const { service, repository, audit } = harness();
    repository.markSuppressed.mockResolvedValue(intent({ status: NotificationIntentStatus.SUPPRESSED }));

    await service.markSuppressed({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      workerIdentity: 'worker-replica-1',
      reasonCode: 'HUMAN_TAKEN',
      consentVersion: 4,
      handoffVersion: 8,
      now,
    });

    expect(repository.markSuppressed).toHaveBeenCalledWith(expect.objectContaining({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      reasonCode: 'HUMAN_TAKEN',
      consentVersion: 4,
      handoffVersion: 8,
      now,
    }));
    expect(repository.markSuppressed.mock.calls[0]?.[0].claimOwnerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_SUPPRESSED',
      module: 'notifications',
      entityId: 'notification-1',
      result: 'BLOCKED',
      reasonCode: 'HUMAN_TAKEN',
    }));
  });

  it('audits a command-pending transition with the bound secure command and outbound identifiers', async () => {
    const { service, repository, audit } = harness();
    repository.markCommandPending.mockResolvedValue(intent({ status: NotificationIntentStatus.COMMAND_PENDING }));

    await service.markCommandPending({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      workerIdentity: 'worker-replica-1',
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      now,
    });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_COMMAND_PENDING',
      module: 'notifications',
      entityId: 'notification-1',
      result: 'SUCCESS',
      metadata: { secureCommandId: 'command-1', outboundMessageId: 'outbound-1' },
    }));
  });

  it('queries post-command reconciliation separately from send claims', async () => {
    const { service, repository } = harness();
    repository.findReconciliationCandidates.mockResolvedValue([]);

    await service.findReconciliationCandidates(now, 10);

    expect(repository.findReconciliationCandidates).toHaveBeenCalledWith(now, 10, 3, false);
    expect(repository.findClaimCandidates).not.toHaveBeenCalled();
  });

  it('defers a pending command with bounded scheduling and no resend', async () => {
    const { service, repository, audit } = harness();
    repository.deferReconciliation.mockResolvedValue(intent({ status: NotificationIntentStatus.COMMAND_PENDING }));

    await service.reconcile({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      currentStatus: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      observation: 'COMMAND_PENDING',
      now,
    });

    expect(repository.deferReconciliation).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      expectedStatus: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      outboundMessageId: null,
      nextRetryAt: new Date('2026-08-08T12:00:05.000Z'),
    });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_RECONCILIATION_DEFERRED',
      module: 'notifications',
      result: 'NO_OP',
    }));
  });

  it('accepts authoritative outbound success after a crash in COMMAND_PENDING', async () => {
    const { service, repository, audit } = harness();
    repository.reconcile.mockResolvedValue(intent({ id: 'notification-1', status: NotificationIntentStatus.SUCCEEDED }));

    await service.reconcile({
      notificationIntentId: 'notification-1',
      expectedVersion: 3,
      currentStatus: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      observation: 'OUTBOUND_SUCCEEDED',
      now,
    });

    expect(repository.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: NotificationIntentStatus.COMMAND_PENDING,
      targetStatus: NotificationIntentStatus.SUCCEEDED,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      completedAt: now,
      incrementAttempts: false,
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_RECONCILIATION_SUCCEEDED',
      module: 'notifications',
      entityId: 'notification-1',
      result: 'SUCCESS',
    }));
  });

  it('rejects implicit UNKNOWN_RESULT resolution and permits explicit authoritative reconciliation', async () => {
    const { service, repository } = harness();
    const input = {
      notificationIntentId: 'notification-1',
      expectedVersion: 4,
      currentStatus: NotificationIntentStatus.UNKNOWN_RESULT,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      observation: 'OUTBOUND_SUCCEEDED' as const,
      now,
    };

    expect(() => service.reconcile(input)).toThrow('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
    repository.reconcile.mockResolvedValue(intent({ status: NotificationIntentStatus.SUCCEEDED }));
    await expect(service.reconcile({ ...input, explicitReconciliation: true })).resolves.toBeDefined();
    expect(repository.reconcile).toHaveBeenCalledTimes(1);
  });

  it('sweeps pre-dispatch exhaustion to FAILED and post-dispatch exhaustion to UNKNOWN_RESULT', async () => {
    const { service, repository, audit } = harness();
    repository.findMaintenanceCandidates.mockResolvedValue([
      { id: 'pending-1', status: NotificationIntentStatus.PENDING, version: 2, attempts: 3, expiresAt: null, leaseExpiresAt: null },
      { id: 'dispatch-1', status: NotificationIntentStatus.DISPATCHED, version: 4, attempts: 3, expiresAt: null, leaseExpiresAt: null },
    ]);
    repository.settleMaintenance
      .mockResolvedValueOnce(intent({ id: 'pending-1', status: NotificationIntentStatus.FAILED }))
      .mockResolvedValueOnce(intent({ id: 'dispatch-1', status: NotificationIntentStatus.UNKNOWN_RESULT }));

    await service.sweepMaintenance(now);

    expect(repository.settleMaintenance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      notificationIntentId: 'pending-1',
      targetStatus: NotificationIntentStatus.FAILED,
      errorCode: 'NOTIFICATION_ATTEMPTS_EXHAUSTED',
    }));
    expect(repository.settleMaintenance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      notificationIntentId: 'dispatch-1',
      targetStatus: NotificationIntentStatus.UNKNOWN_RESULT,
      errorCode: 'NOTIFICATION_RECONCILIATION_ATTEMPTS_EXHAUSTED',
    }));
    expect(audit.log).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'NOTIFICATION_MAINTENANCE_SETTLED',
      module: 'notifications',
      entityId: 'pending-1',
      result: 'FAILED',
      reasonCode: 'NOTIFICATION_ATTEMPTS_EXHAUSTED',
    }));
    expect(audit.log).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'NOTIFICATION_MAINTENANCE_SETTLED',
      module: 'notifications',
      entityId: 'dispatch-1',
      result: 'BLOCKED',
      reasonCode: 'NOTIFICATION_RECONCILIATION_ATTEMPTS_EXHAUSTED',
    }));
  });

  it('audits UNKNOWN_RESULT as a blocked, non-retryable terminal state requiring human reconciliation', async () => {
    const { service, repository, audit } = harness();
    repository.markUnknownResult.mockResolvedValue(intent({ id: 'notification-1', status: NotificationIntentStatus.UNKNOWN_RESULT }));

    await service.markUnknownResult('notification-1', 4, 'PROVIDER_RESULT_UNKNOWN', now);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_UNKNOWN_RESULT',
      module: 'notifications',
      entityId: 'notification-1',
      result: 'BLOCKED',
      reasonCode: 'PROVIDER_RESULT_UNKNOWN',
      metadata: { requiresHumanReconciliation: true },
    }));
  });
});
