import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntentStatus,
  type NotificationIntent,
} from '@prisma/client';
import { PrismaNotificationIntentRepository } from './prisma-notification-intent.repository';

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
    factEnvelope: { orderStatus: 'CONFIRMED' },
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
  const notificationIntent = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma = { notificationIntent };
  return { repository: new PrismaNotificationIntentRepository(prisma as never), notificationIntent };
}

describe('PrismaNotificationIntentRepository', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const createInput = {
    eventType: 'ORDER_CONFIRMED',
    sourceEventId: 'event-1',
    aggregateType: 'ORDER_CHECKOUT',
    aggregateId: 'checkout-1',
    aggregateVersion: 1,
    customerId: null,
    conversationId: null,
    channel: CustomerConsentChannel.WHATSAPP,
    purpose: CustomerConsentPurpose.SERVICE,
    factEnvelope: { orderStatus: 'CONFIRMED' },
    factHash: 'a'.repeat(64),
    policyOutcome: 'ALLOWED' as const,
    policyReason: null,
    consentVersion: 2,
    handoffVersion: 3,
    expiresAt: null,
    now,
  };

  it('creates through the producer-namespaced idempotency identity', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.upsert.mockResolvedValue(intent());

    await expect(repository.create(createInput)).resolves.toMatchObject({ id: 'notification-1' });

    expect(notificationIntent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        aggregateType_sourceEventId_channel_purpose: {
          aggregateType: 'ORDER_CHECKOUT',
          sourceEventId: 'event-1',
          channel: CustomerConsentChannel.WHATSAPP,
          purpose: CustomerConsentPurpose.SERVICE,
        },
      },
      update: {},
    }));
  });

  it('rejects a replay whose immutable facts differ', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.upsert.mockResolvedValue(intent({ factHash: 'b'.repeat(64) }));

    await expect(repository.create(createInput)).rejects.toThrow('NOTIFICATION_INTENT_IDEMPOTENCY_CONFLICT');
  });

  it('allows one claim winner and reports the active lease to a competitor', async () => {
    const { repository, notificationIntent } = harness();
    const claimed = intent({
      status: NotificationIntentStatus.CLAIMED,
      attempts: 1,
      claimOwnerHash: 'c'.repeat(64),
      leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
      version: 1,
    });
    notificationIntent.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    notificationIntent.findUnique.mockResolvedValue(claimed);
    const command = {
      notificationIntentId: 'notification-1',
      claimOwnerHash: 'c'.repeat(64),
      leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
      maxAttempts: 3,
      now,
    };

    await expect(repository.claim(command)).resolves.toMatchObject({ state: 'CLAIMED' });
    await expect(repository.claim(command)).resolves.toMatchObject({ state: 'ACTIVE' });

    const claimMutation = notificationIntent.updateMany.mock.calls[1]?.[0];
    expect(claimMutation).toMatchObject({
      where: {
        id: 'notification-1',
        attempts: { lt: 3 },
      },
      data: {
        status: NotificationIntentStatus.CLAIMED,
        attempts: { increment: 1 },
      },
    });
  });

  it('renews only a live claim owned by the expected fenced worker', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const input = {
      notificationIntentId: 'notification-1',
      expectedVersion: 1,
      claimOwnerHash: 'c'.repeat(64),
      leaseExpiresAt: new Date('2026-08-08T12:01:00.000Z'),
      now,
    };

    await expect(repository.renewClaim(input)).resolves.toBe(true);
    await expect(repository.renewClaim(input)).resolves.toBe(false);

    expect(notificationIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'notification-1',
        version: 1,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: 'c'.repeat(64),
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date('2026-08-08T12:01:00.000Z') },
    });
  });

  it('reclaims only a pre-dispatch CLAIMED lease', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.findMany.mockResolvedValue([]);

    await repository.findClaimCandidates(now, 25, 4);

    expect(notificationIntent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        attempts: { lt: 4 },
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { status: NotificationIntentStatus.PENDING },
              {
                status: NotificationIntentStatus.CLAIMED,
                leaseExpiresAt: { lte: now },
              },
            ]),
          }),
        ]),
      }),
    }));
    const serialized = JSON.stringify(notificationIntent.findMany.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(NotificationIntentStatus.COMMAND_PENDING);
    expect(serialized).not.toContain(NotificationIntentStatus.DISPATCHED);
    expect(serialized).not.toContain(NotificationIntentStatus.UNKNOWN_RESULT);
  });

  it('queries command and outbound reconciliation without making them send-claim candidates', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.findMany.mockResolvedValue([]);

    await repository.findReconciliationCandidates(now, 20, 3, false);

    expect(notificationIntent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [expect.objectContaining({
          status: { in: [NotificationIntentStatus.COMMAND_PENDING, NotificationIntentStatus.DISPATCHED] },
          attempts: { lt: 3 },
        })],
      },
      take: 20,
    }));
    const statuses = notificationIntent.findMany.mock.calls[0]?.[0].where.OR[0].status.in;
    expect(statuses).toEqual([NotificationIntentStatus.COMMAND_PENDING, NotificationIntentStatus.DISPATCHED]);
  });

  it('includes UNKNOWN_RESULT only for an explicit reconciliation query', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.findMany.mockResolvedValue([]);

    await repository.findReconciliationCandidates(now, 20, 3, true);

    expect(JSON.stringify(notificationIntent.findMany.mock.calls[0]?.[0]))
      .toContain(NotificationIntentStatus.UNKNOWN_RESULT);
  });

  it('crosses the external-dispatch boundary only with an active fenced claim', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({
      status: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      version: 2,
    }));

    await repository.markCommandPending({
      notificationIntentId: 'notification-1',
      expectedVersion: 1,
      claimOwnerHash: 'c'.repeat(64),
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      now,
    });

    expect(notificationIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'notification-1',
        version: 1,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: 'c'.repeat(64),
        leaseExpiresAt: { gt: now },
      },
      data: expect.objectContaining({
        status: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId: 'command-1',
        outboundMessageId: 'outbound-1',
        claimOwnerHash: null,
        leaseExpiresAt: null,
      }),
    });
  });

  it('suppresses only the active fenced claim and records current policy versions', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({ status: NotificationIntentStatus.SUPPRESSED }));

    await repository.markSuppressed({
      notificationIntentId: 'notification-1',
      expectedVersion: 1,
      claimOwnerHash: 'c'.repeat(64),
      reasonCode: 'HUMAN_TAKEN',
      consentVersion: 4,
      handoffVersion: 8,
      now,
    });

    expect(notificationIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'notification-1',
        version: 1,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: 'c'.repeat(64),
        leaseExpiresAt: { gt: now },
      },
      data: expect.objectContaining({
        status: NotificationIntentStatus.SUPPRESSED,
        policyOutcome: 'SUPPRESSED',
        policyReason: 'HUMAN_TAKEN',
        consentVersion: 4,
        handoffVersion: 8,
        completedAt: now,
      }),
    });
  });

  it('keeps UNKNOWN_RESULT terminal and outside the claim set', async () => {
    const { repository, notificationIntent } = harness();
    const unknown = intent({ status: NotificationIntentStatus.UNKNOWN_RESULT, attempts: 1 });
    notificationIntent.updateMany.mockResolvedValue({ count: 0 });
    notificationIntent.findUnique.mockResolvedValue(unknown);

    await expect(repository.claim({
      notificationIntentId: unknown.id,
      claimOwnerHash: 'c'.repeat(64),
      leaseExpiresAt: new Date('2026-08-08T12:00:30.000Z'),
      maxAttempts: 3,
      now,
    })).resolves.toEqual({ state: 'UNKNOWN_RESULT', intent: unknown });
  });

  it('returns a pre-dispatch failure to PENDING only below the attempt ceiling', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({
      status: NotificationIntentStatus.PENDING,
      attempts: 1,
      nextRetryAt: new Date('2026-08-08T12:00:05.000Z'),
      version: 2,
    }));

    await repository.markPreDispatchFailure({
      notificationIntentId: 'notification-1',
      expectedVersion: 1,
      claimOwnerHash: 'c'.repeat(64),
      errorCode: 'POLICY_TEMPORARILY_UNAVAILABLE',
      maxAttempts: 3,
      nextRetryAt: new Date('2026-08-08T12:00:05.000Z'),
      now,
    });

    expect(notificationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: NotificationIntentStatus.CLAIMED,
        attempts: { lt: 3 },
      }),
      data: expect.objectContaining({
        status: NotificationIntentStatus.PENDING,
        lastErrorCode: 'POLICY_TEMPORARILY_UNAVAILABLE',
      }),
    }));
  });

  it('defers command reconciliation with the immutable command binding and a bounded attempt', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({
      status: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      attempts: 2,
      version: 3,
    }));

    await repository.deferReconciliation({
      notificationIntentId: 'notification-1',
      expectedVersion: 2,
      expectedStatus: NotificationIntentStatus.COMMAND_PENDING,
      secureCommandId: 'command-1',
      outboundMessageId: null,
      nextRetryAt: new Date('2026-08-08T12:00:05.000Z'),
    });

    expect(notificationIntent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'notification-1',
        version: 2,
        status: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId: 'command-1',
      },
      data: {
        nextRetryAt: new Date('2026-08-08T12:00:05.000Z'),
        attempts: { increment: 1 },
        version: { increment: 1 },
      },
    });
  });

  it('reconciles a command-pending crash to success with exact command and outbound binding', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({
      status: NotificationIntentStatus.SUCCEEDED,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      version: 5,
    }));

    await repository.reconcile({
      notificationIntentId: 'notification-1',
      expectedVersion: 4,
      expectedStatus: NotificationIntentStatus.COMMAND_PENDING,
      targetStatus: NotificationIntentStatus.SUCCEEDED,
      secureCommandId: 'command-1',
      outboundMessageId: 'outbound-1',
      errorCode: null,
      completedAt: now,
      nextRetryAt: null,
      incrementAttempts: false,
    });

    expect(notificationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'notification-1',
        version: 4,
        status: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId: 'command-1',
      },
      data: expect.objectContaining({
        status: NotificationIntentStatus.SUCCEEDED,
        outboundMessageId: 'outbound-1',
        completedAt: now,
      }),
    }));
  });

  it('makes exhausted post-dispatch work sweepable to terminal UNKNOWN_RESULT', async () => {
    const { repository, notificationIntent } = harness();
    notificationIntent.findMany.mockResolvedValue([]);
    notificationIntent.updateMany.mockResolvedValue({ count: 1 });
    notificationIntent.findUnique.mockResolvedValue(intent({ status: NotificationIntentStatus.UNKNOWN_RESULT }));

    await repository.findMaintenanceCandidates(now, 25, 3);
    expect(JSON.stringify(notificationIntent.findMany.mock.calls[0]?.[0]))
      .toContain(NotificationIntentStatus.DISPATCHED);

    await repository.settleMaintenance({
      notificationIntentId: 'notification-1',
      expectedVersion: 7,
      expectedStatus: NotificationIntentStatus.DISPATCHED,
      targetStatus: NotificationIntentStatus.UNKNOWN_RESULT,
      errorCode: 'NOTIFICATION_RECONCILIATION_ATTEMPTS_EXHAUSTED',
      now,
    });
    expect(notificationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'notification-1',
        version: 7,
        status: NotificationIntentStatus.DISPATCHED,
      }),
      data: expect.objectContaining({
        status: NotificationIntentStatus.UNKNOWN_RESULT,
        completedAt: now,
        nextRetryAt: null,
      }),
    }));
  });
});
