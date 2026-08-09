import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntentStatus,
  type NotificationIntent,
} from '@prisma/client';
import {
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
} from './notification-dispatch.ports';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';

const now = new Date('2026-08-08T12:00:00.000Z');
const commandFacts = Object.freeze({
  outboundMessageId: 'outbound-1',
  conversationId: 'conversation-1',
  recipientIdentityHash: 'a'.repeat(64),
  bodyHash: 'b'.repeat(64),
  accountId: 'account-1',
  expectedConversationVersion: 3,
});

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: 'notification-1',
    eventType: 'ORDER_CONFIRMED',
    sourceEventId: 'event-1',
    aggregateType: 'ORDER_CHECKOUT',
    aggregateId: 'checkout-1',
    aggregateVersion: 1,
    customerId: 'customer-1',
    conversationId: 'conversation-1',
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    factEnvelope: commandFacts,
    factHash: 'c'.repeat(64),
    policyOutcome: 'ALLOWED',
    policyReason: null,
    consentVersion: 2,
    handoffVersion: 3,
    status: NotificationIntentStatus.CLAIMED,
    attempts: 1,
    claimOwnerHash: 'd'.repeat(64),
    leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
    nextRetryAt: null,
    expiresAt: new Date('2026-08-08T12:04:00.000Z'),
    completedAt: null,
    lastErrorCode: null,
    outboundMessageId: null,
    secureCommandId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function harness(overrides: { claim?: unknown; policy?: unknown; command?: unknown } = {}) {
  const outbox = {
    findClaimCandidates: jest.fn().mockResolvedValue([]),
    claim: jest.fn().mockResolvedValue(overrides.claim ?? { state: 'CLAIMED', intent: intent() }),
    markSuppressed: jest.fn().mockResolvedValue(intent({ status: NotificationIntentStatus.SUPPRESSED })),
    markPreDispatchFailure: jest.fn().mockResolvedValue(intent({ status: NotificationIntentStatus.PENDING })),
    markCommandPending: jest.fn().mockResolvedValue(intent({ status: NotificationIntentStatus.COMMAND_PENDING })),
    reconcile: jest.fn(),
  };
  const policy = {
    evaluate: jest.fn().mockResolvedValue(overrides.policy ?? {
      allowed: true,
      reasonCode: 'NOTIFICATION_POLICY_ALLOWED',
      consentVersion: 2,
      handoffVersion: 3,
    }),
  };
  const commands = {
    receive: jest.fn().mockResolvedValue(overrides.command ?? { commandId: 'command-1', replayed: false }),
  };
  return {
    service: new NotificationIntentConsumerService(outbox as never, policy as never, commands as never),
    outbox,
    policy,
    commands,
  };
}

describe('NotificationIntentConsumerService', () => {
  it('claims, revalidates policy, creates one bound SecureCommand and never executes it', async () => {
    const { service, outbox, policy, commands } = harness();

    await expect(service.consume('notification-1', 'worker-1', now)).resolves.toEqual({
      notificationIntentId: 'notification-1',
      state: 'COMMAND_PENDING',
      reasonCode: 'SECURE_COMMAND_CREATED',
      secureCommandId: 'command-1',
    });

    expect(outbox.claim).toHaveBeenCalledWith('notification-1', 'worker-1', now);
    expect(policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({ id: 'notification-1' }));
    expect(commands.receive).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      binding: {
        ...commandFacts,
        purpose: CustomerConsentPurpose.SERVICE,
      },
      expiresAt: new Date('2026-08-08T12:04:00.000Z'),
    });
    expect(outbox.markCommandPending).toHaveBeenCalledWith({
      notificationIntentId: 'notification-1',
      expectedVersion: 1,
      workerIdentity: 'worker-1',
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      now,
    });
    expect(commands).not.toHaveProperty('execute');
  });

  it('durably suppresses when consent, handoff or governance denies automation', async () => {
    const { service, outbox, commands } = harness({
      policy: { allowed: false, reasonCode: 'HUMAN_TAKEN', consentVersion: 4, handoffVersion: 8 },
    });

    await expect(service.consume('notification-1', 'worker-1', now)).resolves.toMatchObject({
      state: 'SUPPRESSED',
      reasonCode: 'HUMAN_TAKEN',
    });
    expect(outbox.markSuppressed).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'HUMAN_TAKEN',
      consentVersion: 4,
      handoffVersion: 8,
    }));
    expect(commands.receive).not.toHaveBeenCalled();
  });

  it('suppresses stale consent or handoff bindings before command creation', async () => {
    const { service, outbox, commands } = harness({
      policy: { allowed: true, reasonCode: 'NOTIFICATION_POLICY_ALLOWED', consentVersion: 3, handoffVersion: 3 },
    });

    await expect(service.consume('notification-1', 'worker-1', now)).resolves.toMatchObject({
      state: 'SUPPRESSED',
      reasonCode: 'NOTIFICATION_POLICY_VERSION_STALE',
    });
    expect(outbox.markSuppressed).toHaveBeenCalled();
    expect(commands.receive).not.toHaveBeenCalled();
  });

  it('keeps SOFIA_SEND_WHATSAPP disabled as a terminal suppression without provider access', async () => {
    const { service, outbox, commands } = harness();
    commands.receive.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'SOFIA_COMMAND_POLICY_BLOCKED' }));

    await expect(service.consume('notification-1', 'worker-1', now)).resolves.toMatchObject({
      state: 'SUPPRESSED',
      reasonCode: 'SOFIA_COMMAND_POLICY_BLOCKED',
    });
    expect(outbox.markSuppressed).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'SOFIA_COMMAND_POLICY_BLOCKED',
    }));
    expect(commands.receive).toHaveBeenCalledTimes(1);
    expect(commands).not.toHaveProperty('execute');
  });

  it('does not reclaim an active lease or produce a second command', async () => {
    const { service, commands } = harness({ claim: { state: 'ACTIVE', intent: intent() } });

    await expect(service.consume('notification-1', 'worker-2', now)).resolves.toMatchObject({
      state: 'SKIPPED',
      reasonCode: 'NOTIFICATION_ACTIVE',
    });
    expect(commands.receive).not.toHaveBeenCalled();
  });

  it('reconciles UNKNOWN_RESULT only through explicit authoritative evidence and never resends', async () => {
    const { service, outbox, commands } = harness();
    outbox.reconcile.mockResolvedValue(intent({ status: NotificationIntentStatus.SUCCEEDED }));

    await service.reconcile({
      notificationIntentId: 'notification-1',
      expectedVersion: 5,
      currentStatus: NotificationIntentStatus.UNKNOWN_RESULT,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      observation: 'OUTBOUND_SUCCEEDED',
      explicitReconciliation: true,
      now,
    });

    expect(outbox.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      currentStatus: NotificationIntentStatus.UNKNOWN_RESULT,
      explicitReconciliation: true,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
    }));
    expect(commands.receive).not.toHaveBeenCalled();
  });
});

describe('SecureCommandNotificationAdapter', () => {
  it('uses SecureCommandService.receive with immutable outbound binding and exposes no execute path', async () => {
    const receive = jest.fn().mockResolvedValue({ command: { id: 'command-1' }, replayed: true });
    const modules = { get: jest.fn().mockReturnValue({ receive }) };
    const adapter = new SecureCommandNotificationAdapter(modules as never);

    await expect(adapter.receive({
      notificationIntentId: 'notification-1',
      binding: { ...commandFacts, purpose: CustomerConsentPurpose.SERVICE },
      expiresAt: new Date('2026-08-08T12:04:00.000Z'),
    })).resolves.toEqual({ commandId: 'command-1', replayed: true });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'SOFIA_SEND_WHATSAPP',
      idempotencyKey: 'notification:notification-1',
      target: {
        type: 'WhatsappOutboundMessage',
        id: 'outbound-1',
        expectedVersion: '3',
      },
      payload: {
        outboundMessageId: 'outbound-1',
        conversationId: 'conversation-1',
        recipientIdentityHash: 'a'.repeat(64),
        purpose: CustomerConsentPurpose.SERVICE,
        bodyHash: 'b'.repeat(64),
        accountId: 'account-1',
      },
    }));
    expect(adapter).not.toHaveProperty('execute');
  });
});

describe('WhatsappNotificationDispatchPolicyAdapter', () => {
  it('delegates consent, handoff and governance to the existing WhatsApp policy authority', async () => {
    const outbound = jest.fn().mockResolvedValue({
      consent: { version: 7 },
      handoff: { version: 9 },
      safety: { globalPaused: false, killSwitchActive: false },
    });
    const modules = { get: jest.fn().mockReturnValue({ outbound }) };
    const adapter = new WhatsappNotificationDispatchPolicyAdapter(modules as never);

    await expect(adapter.evaluate(intent())).resolves.toEqual({
      allowed: true,
      reasonCode: 'NOTIFICATION_POLICY_ALLOWED',
      consentVersion: 7,
      handoffVersion: 9,
    });
    expect(outbound).toHaveBeenCalledWith('conversation-1', 'customer-1', 'SERVICE');
  });
});
