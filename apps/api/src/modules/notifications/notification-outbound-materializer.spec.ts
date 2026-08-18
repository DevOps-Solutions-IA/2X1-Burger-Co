import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntentStatus,
  type NotificationIntent,
  type WhatsappOutboundMessage,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { deterministicNotificationHash } from './domain';
import { PrismaNotificationOutboundMaterializer } from './notification-outbound-materializer';

const now = new Date('2026-08-09T12:00:00.000Z');
const body = 'Tu pedido esta listo para recoger.';
const bodyHash = createHash('sha256').update(body).digest('hex');

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: 'notification-1',
    eventType: 'READY_FOR_PICKUP',
    sourceEventId: 'delivery-event-1',
    aggregateType: 'ORDER_TICKET',
    aggregateId: 'ticket-1',
    aggregateVersion: 4,
    customerId: 'customer-1',
    conversationId: 'conversation-1',
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    factEnvelope: {
      conversationId: 'conversation-1',
      accountId: 'account-1',
      recipientIdentityHash: 'a'.repeat(64),
      expectedConversationVersion: 3,
      body,
      bodyHash,
    },
    factHash: deterministicNotificationHash({
      conversationId: 'conversation-1',
      accountId: 'account-1',
      recipientIdentityHash: 'a'.repeat(64),
      expectedConversationVersion: 3,
      body,
      bodyHash,
    }),
    policyOutcome: 'ALLOWED',
    policyReason: null,
    consentVersion: 2,
    handoffVersion: 3,
    status: NotificationIntentStatus.CLAIMED,
    attempts: 1,
    claimOwnerHash: 'c'.repeat(64),
    leaseExpiresAt: new Date('2026-08-09T12:00:30.000Z'),
    nextRetryAt: null,
    expiresAt: new Date('2026-08-09T12:05:00.000Z'),
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

function outbound(overrides: Partial<WhatsappOutboundMessage> = {}): WhatsappOutboundMessage {
  return {
    id: 'outbound-1',
    conversationId: 'conversation-1',
    inboundMessageId: null,
    provider: 'qr_gateway',
    providerMessageId: null,
    localMessageId: `notification-${createHash('sha256').update('notification:notification-1').digest('hex').slice(0, 32)}`,
    body,
    mediaUrl: null,
    status: 'APPROVAL_PENDING',
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    idempotencyKey: 'notification:notification-1',
    createdAt: now,
    sentAt: null,
    approvedById: null,
    approvedAt: null,
    rawPayload: null,
    accountId: 'account-1',
    secureCommandId: null,
    recipientIdentityHash: 'a'.repeat(64),
    purpose: CustomerConsentPurpose.SERVICE,
    unknownResult: false,
    autoSafeDecisionEventId: null,
    ...overrides,
  };
}

function harness(existing: WhatsappOutboundMessage | null = null) {
  const tx = {
    whatsappConversation: {
      findUnique: jest.fn().mockResolvedValue({ id: 'conversation-1', provider: 'qr_gateway', handoffVersion: 3 }),
    },
    whatsappProviderAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 'account-1', provider: 'qr_gateway', status: 'VERIFIED_RECEIVE_ONLY' }),
    },
    whatsappOutboundMessage: {
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue(outbound()),
    },
  };
  const prisma = { $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)) };
  return { service: new PrismaNotificationOutboundMaterializer(prisma as never), prisma, tx };
}

describe('PrismaNotificationOutboundMaterializer', () => {
  it('creates one canonical approval-pending outbound with deterministic bindings', async () => {
    const { service, tx } = harness();

    await expect(service.materialize(intent())).resolves.toMatchObject({
      replayed: false,
      outbound: { id: 'outbound-1', status: 'APPROVAL_PENDING' },
      binding: {
        outboundMessageId: 'outbound-1',
        conversationId: 'conversation-1',
        bodyHash,
        accountId: 'account-1',
        expectedConversationVersion: 3,
      },
    });
    expect(tx.whatsappOutboundMessage.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: 'notification:notification-1' },
      create: expect.objectContaining({
        status: 'APPROVAL_PENDING',
        provider: 'qr_gateway',
        body,
        mediaUrl: null,
        idempotencyKey: 'notification:notification-1',
      }),
      update: {},
    });
  });

  it('replays the same outbound after a lost response without creating another row', async () => {
    const existing = outbound();
    const { service, tx } = harness(existing);

    await expect(service.materialize(intent())).resolves.toMatchObject({
      replayed: true,
      outbound: { id: existing.id },
    });
    expect(tx.whatsappOutboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('fails closed on an idempotency binding mismatch', async () => {
    const { service } = harness(outbound({ body: 'Contenido distinto.' }));
    await expect(service.materialize(intent())).rejects.toThrow('NOTIFICATION_OUTBOUND_IDEMPOTENCY_CONFLICT');
  });

  it('rejects body hash changes and account or conversation drift before command creation', async () => {
    const changedFacts = { ...(intent().factEnvelope as object), bodyHash: 'd'.repeat(64) };
    const hashMismatch = intent({ factEnvelope: changedFacts, factHash: deterministicNotificationHash(changedFacts) });
    await expect(harness().service.materialize(hashMismatch)).rejects.toThrow('NOTIFICATION_FACT_HASH_MISMATCH');

    const drift = harness();
    drift.tx.whatsappProviderAccount.findUnique.mockResolvedValue({
      id: 'account-1', provider: 'other', status: 'VERIFIED_RECEIVE_ONLY',
    });
    await expect(drift.service.materialize(intent())).rejects.toThrow('NOTIFICATION_OUTBOUND_AUTHORITY_MISMATCH');
  });
});
