import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntentStatus,
  type NotificationIntent,
  type WhatsappDeliveryStatus,
} from '@prisma/client';
import { NotificationIntentConsumerService } from '../modules/notifications/notification-intent-consumer.service';
import { WhatsappDeliveryStatusService } from '../modules/sofia/whatsapp/production/whatsapp-delivery-status.service';
import type { WhatsappProductionRepository } from '../modules/sofia/whatsapp/production/whatsapp-production.repository';

const now = new Date('2026-08-09T12:00:00.000Z');
const BURST_SIZE = 32;

function intent(id: string): NotificationIntent {
  return {
    id,
    eventType: 'ORDER_CONFIRMED',
    sourceEventId: `event-${id}`,
    aggregateType: 'ORDER_CHECKOUT',
    aggregateId: `checkout-${id}`,
    aggregateVersion: 1,
    customerId: `customer-${id}`,
    conversationId: `conversation-${id}`,
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    factEnvelope: {
      conversationId: `conversation-${id}`,
      recipientIdentityHash: 'a'.repeat(64),
      body: 'Tu pedido esta listo.',
      bodyHash: 'b'.repeat(64),
      accountId: 'account-1',
      expectedConversationVersion: 3,
    },
    factHash: 'c'.repeat(64),
    policyOutcome: 'ALLOWED',
    policyReason: null,
    consentVersion: 2,
    handoffVersion: 3,
    status: NotificationIntentStatus.CLAIMED,
    attempts: 1,
    claimOwnerHash: 'd'.repeat(64),
    leaseExpiresAt: new Date('2026-08-09T12:00:30.000Z'),
    nextRetryAt: null,
    expiresAt: new Date('2026-08-09T12:04:00.000Z'),
    completedAt: null,
    lastErrorCode: null,
    outboundMessageId: null,
    secureCommandId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function consumerHarness(input: {
  claim: (id: string) => Promise<unknown>;
  policy?: (record: NotificationIntent) => Promise<unknown>;
  materialize?: jest.Mock;
  receive?: jest.Mock;
}) {
  const outbox = {
    claim: jest.fn((id: string) => input.claim(id)),
    renewClaim: jest.fn().mockResolvedValue(true),
    markSuppressed: jest.fn().mockResolvedValue(intent('suppressed')),
    markPreDispatchFailure: jest.fn().mockResolvedValue(intent('retry')),
    markCommandPending: jest.fn().mockResolvedValue(intent('pending')),
  };
  const materializer = {
    materialize: input.materialize ?? jest.fn(async (record: NotificationIntent) => ({
      outbound: { id: `outbound-${record.id}` },
      replayed: false,
      binding: {
        outboundMessageId: `outbound-${record.id}`,
        conversationId: record.conversationId,
        recipientIdentityHash: 'a'.repeat(64),
        bodyHash: 'b'.repeat(64),
        accountId: 'account-1',
        expectedConversationVersion: 3,
        purpose: CustomerConsentPurpose.SERVICE,
      },
    })),
  };
  const commands = {
    receive: input.receive ?? jest.fn(async ({ notificationIntentId }: { notificationIntentId: string }) => ({
      commandId: `command-${notificationIntentId}`,
      replayed: false,
    })),
  };
  const policy = {
    evaluate: jest.fn(input.policy ?? (async () => ({
      allowed: true,
      reasonCode: 'NOTIFICATION_POLICY_ALLOWED',
      consentVersion: 2,
      handoffVersion: 3,
    }))),
  };
  return {
    service: new NotificationIntentConsumerService(
      outbox as never,
      policy as never,
      materializer as never,
      commands as never,
    ),
    outbox,
    policy,
    materializer,
    commands,
  };
}

describe('Phase 7 duplicate and out-of-order event bursts', () => {
  it('keeps one monotonic WhatsApp status effect under duplicate and regressive events', async () => {
    let latest: WhatsappDeliveryStatus | null = null;
    const persistedEventIds = new Set<string>();
    const appendStatus = jest.fn(async (input: { providerStatusEventId: string; status: WhatsappDeliveryStatus }) => {
      const duplicate = persistedEventIds.has(input.providerStatusEventId);
      if (!duplicate) {
        persistedEventIds.add(input.providerStatusEventId);
        latest = input.status;
      }
      return { duplicate, status: latest };
    });
    const repository = {
      latestStatus: jest.fn(async () => latest),
      appendStatus,
    };
    const service = new WhatsappDeliveryStatusService(
      repository as unknown as WhatsappProductionRepository,
    );
    const base = {
      accountId: 'account-1',
      providerMessageId: 'provider-message-1',
      recipientIdentityHash: 'recipient-hash',
      occurredAt: now,
      payloadHash: 'payload-hash',
    };

    await expect(service.apply({ ...base, providerStatusEventId: 'read-1', status: 'READ' })).resolves.toMatchObject({
      duplicate: false,
    });
    await expect(service.apply({ ...base, providerStatusEventId: 'read-1', status: 'READ' })).resolves.toMatchObject({
      duplicate: true,
    });
    const staleStatuses = ['ACCEPTED', 'SENT', 'DELIVERED'] as const;
    const regressions = await Promise.allSettled(
      Array.from({ length: BURST_SIZE }, (_, index) => service.apply({
        ...base,
        providerStatusEventId: `stale-${index}`,
        status: staleStatuses[index % staleStatuses.length]!,
      })),
    );

    expect(regressions.every((result) => result.status === 'rejected')).toBe(true);
    expect(latest).toBe('READ');
    expect(persistedEventIds).toEqual(new Set(['read-1']));
    expect(appendStatus).toHaveBeenCalledTimes(2);
  });
});

describe('Phase 7 notification duplicate/retry and automation suppression bursts', () => {
  it('allows one orchestration path for duplicate consumers; PostgreSQL single-winner authority remains phase6-persistence-concurrency.integration.spec.ts', async () => {
    let claimed = false;
    const harness = consumerHarness({
      claim: async (id) => {
        if (claimed) return { state: 'ACTIVE', intent: intent(id) };
        claimed = true;
        return { state: 'CLAIMED', intent: intent(id) };
      },
    });

    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, index) =>
        harness.service.consume('notification-duplicate', `worker-${index}`, now)),
    );

    expect(results.filter((result) => result.state === 'COMMAND_PENDING')).toHaveLength(1);
    expect(results.filter((result) => result.reasonCode === 'NOTIFICATION_ACTIVE')).toHaveLength(BURST_SIZE - 1);
    expect(harness.materializer.materialize).toHaveBeenCalledTimes(1);
    expect(harness.commands.receive).toHaveBeenCalledTimes(1);
    expect(harness.outbox.markCommandPending).toHaveBeenCalledTimes(1);
  });

  it('retries only a pre-dispatch failure and creates one command after recovery', async () => {
    const materialize = jest.fn()
      .mockRejectedValueOnce(new Error('NOTIFICATION_DEPENDENCY_UNAVAILABLE'))
      .mockResolvedValueOnce({
        outbound: { id: 'outbound-retry' },
        replayed: false,
        binding: {
          outboundMessageId: 'outbound-retry',
          conversationId: 'conversation-notification-retry',
          recipientIdentityHash: 'a'.repeat(64),
          bodyHash: 'b'.repeat(64),
          accountId: 'account-1',
          expectedConversationVersion: 3,
          purpose: CustomerConsentPurpose.SERVICE,
        },
      });
    const harness = consumerHarness({
      claim: async (id) => ({ state: 'CLAIMED', intent: intent(id) }),
      materialize,
    });

    await expect(harness.service.consume('notification-retry', 'worker-1', now)).resolves.toMatchObject({
      state: 'RETRY_SCHEDULED',
      reasonCode: 'NOTIFICATION_DEPENDENCY_UNAVAILABLE',
    });
    await expect(harness.service.consume('notification-retry', 'worker-2', now)).resolves.toMatchObject({
      state: 'COMMAND_PENDING',
    });

    expect(harness.outbox.markPreDispatchFailure).toHaveBeenCalledTimes(1);
    expect(harness.commands.receive).toHaveBeenCalledTimes(1);
    expect(harness.outbox.markCommandPending).toHaveBeenCalledTimes(1);
  });

  it('suppresses kill-switch and human-taken candidates before materialization across a bounded burst', async () => {
    const harness = consumerHarness({
      claim: async (id) => ({ state: 'CLAIMED', intent: intent(id) }),
      policy: async (record) => {
        const killSwitch = Number(record.id.split('-').at(-1)) % 2 === 0;
        return {
          allowed: false,
          reasonCode: killSwitch ? 'KILL_SWITCH_ACTIVE' : 'HUMAN_TAKEN',
          consentVersion: 2,
          handoffVersion: 4,
        };
      },
    });

    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, index) =>
        harness.service.consume(`notification-suppressed-${index}`, `worker-${index}`, now)),
    );

    expect(results.filter((result) => result.reasonCode === 'KILL_SWITCH_ACTIVE')).toHaveLength(BURST_SIZE / 2);
    expect(results.filter((result) => result.reasonCode === 'HUMAN_TAKEN')).toHaveLength(BURST_SIZE / 2);
    expect(results.every((result) => result.state === 'SUPPRESSED')).toBe(true);
    expect(harness.outbox.markSuppressed).toHaveBeenCalledTimes(BURST_SIZE);
    expect(harness.materializer.materialize).not.toHaveBeenCalled();
    expect(harness.commands.receive).not.toHaveBeenCalled();
  });
});
