import { PaymentIntentProvider, PaymentIntentStatus } from '@prisma/client';
import { PrismaOrderCheckoutRepository } from './prisma-order-checkout.repository';

describe('PrismaOrderCheckoutRepository webhook recovery', () => {
  const evidence = {
    paymentIntentId: 'intent-1',
    provider: PaymentIntentProvider.BOLD,
    eventId: 'evt-1',
    providerPaymentId: 'provider-payment-1',
    providerReference: 'checkout-1',
    eventType: 'PAYMENT',
    status: 'APPROVED',
    amount: 30000,
    currency: 'COP',
    signatureValid: true,
    payloadHash: 'payload-hash',
    providerAccountHash: 'account-hash',
    processedStatus: 'RECEIVED',
    rawPayload: { id: 'evt-1' },
    leaseOwnerHash: 'owner-hash',
    leaseExpiresAt: new Date(Date.now() + 30_000),
    maxAttempts: 3,
  };

  // CANONICAL_TEMPORAL_AUTHORITY (see prisma-order-checkout.repository.ts): every write/read/
  // compare of processing_lease_expires_at / next_retry_at goes through the typed Prisma Client
  // exclusively, never raw $executeRaw/$queryRaw. This harness mocks `tx.paymentWebhookEvent.
  // create/update` and `prisma.paymentWebhookEvent.updateMany/findFirst` accordingly; `$executeRaw`
  // is now used ONLY for the pg_advisory_xact_lock call (and, inside claimWebhookEvidence/
  // claimRecoverableWebhook, the `SELECT ... FOR UPDATE` via `$queryRaw`, mocked separately below).
  function harness(existing: unknown[] = []) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce(existing),
      $executeRaw: jest.fn().mockResolvedValue(1),
      paymentWebhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'webhook-1', paymentIntentId: 'intent-1' }),
        update: jest.fn().mockResolvedValue({ id: 'webhook-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      paymentWebhookEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ processingAttempts: 1, resultCode: null }),
      },
    };
    return { repository: new PrismaOrderCheckoutRepository(prisma as never), prisma, tx };
  }

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'webhook-1',
      paymentIntentId: 'intent-1',
      providerAccountHash: 'account-hash',
      payloadHash: 'payload-hash',
      processedStatus: 'PROCESSING',
      processedAt: null,
      processingAttempts: 1,
      processingLeaseOwnerHash: 'old-owner',
      processingLeaseExpiresAt: new Date(Date.now() - 1_000),
      nextRetryAt: null,
      resultCode: null,
      deterministicResult: null,
      lastErrorCode: null,
      retryable: false,
      transitionApplied: false,
      ...overrides,
    };
  }

  it('creates the evidence and its first lease in one transaction', async () => {
    const { repository, tx } = harness();

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'CLAIMED',
      webhookId: 'webhook-1',
      paymentIntentId: 'intent-1',
      transitionApplied: false,
      attempt: 1,
    });
    expect(tx.paymentWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ processedStatus: 'PROCESSING', processedAt: null }),
    });
    // Only the pg_advisory_xact_lock call remains on $executeRaw; the lease write itself now
    // goes through the typed client (see CANONICAL_TEMPORAL_AUTHORITY note above).
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-1' },
      data: expect.objectContaining({
        processingAttempts: 1,
        processingLeaseOwnerHash: 'owner-hash',
        processingLeaseExpiresAt: evidence.leaseExpiresAt,
        retryable: false,
        nextRetryAt: null,
        lastErrorCode: null,
      }),
    });
  });

  it('reclaims an expired processing lease and preserves transition knowledge', async () => {
    const { repository, tx } = harness([row({ transitionApplied: true })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'CLAIMED',
      webhookId: 'webhook-1',
      paymentIntentId: 'intent-1',
      transitionApplied: true,
      attempt: 2,
    });
    expect(tx.paymentWebhookEvent.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-1' },
      data: expect.objectContaining({
        processingAttempts: 2,
        processingLeaseOwnerHash: 'owner-hash',
        processingLeaseExpiresAt: evidence.leaseExpiresAt,
        retryable: false,
        nextRetryAt: null,
        lastErrorCode: null,
      }),
    });
  });

  it('replays a completed deterministic result without taking another lease', async () => {
    const deterministicResult = {
      processedStatus: 'PROCESSED',
      paymentIntentId: 'intent-1',
      paymentStatus: PaymentIntentStatus.SUCCEEDED,
    };
    const { repository, tx } = harness([row({
      processedStatus: 'PROCESSED',
      processedAt: new Date(),
      deterministicResult,
    })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'REPLAY',
      webhookId: 'webhook-1',
      result: deterministicResult,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('keeps pre-migration incomplete financial evidence blocked for incident review', async () => {
    const { repository, tx } = harness([row({ processingAttempts: 0 })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'BLOCKED',
      webhookId: 'webhook-1',
      reasonCode: 'LEGACY_AMBIGUOUS',
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('closes an exhausted claim instead of retrying it again', async () => {
    const { repository, tx } = harness([row({ processingAttempts: 3 })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'BLOCKED',
      webhookId: 'webhook-1',
      reasonCode: 'ATTEMPTS_EXHAUSTED',
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-1' },
      data: expect.objectContaining({
        processedStatus: 'FAILED',
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        retryable: false,
        nextRetryAt: null,
        resultCode: 'PROCESSING_ATTEMPTS_EXHAUSTED',
      }),
    });
  });

  it('finalizes only the lease owner and stores the deterministic result', async () => {
    const { repository, prisma } = harness();
    await expect(repository.completeWebhookClaim({
      webhookId: 'webhook-1',
      leaseOwnerHash: 'owner-hash',
      result: {
        processedStatus: 'PROCESSED',
        paymentIntentId: 'intent-1',
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
      },
    })).resolves.toBeUndefined();
    expect(prisma.paymentWebhookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'webhook-1',
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: 'owner-hash',
        processingLeaseExpiresAt: { gt: expect.any(Date) },
      },
      data: expect.objectContaining({
        processedStatus: 'PROCESSED',
        resultCode: 'PROCESSED',
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        retryable: false,
        nextRetryAt: null,
        lastErrorCode: null,
      }),
    });

    prisma.paymentWebhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.completeWebhookClaim({
      webhookId: 'webhook-1',
      leaseOwnerHash: 'stale-owner',
      result: {
        processedStatus: 'PROCESSED',
        paymentIntentId: 'intent-1',
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
      },
    })).rejects.toThrow('PAYMENT_WEBHOOK_CLAIM_LOST');
  });

  it('releases only the current claim for bounded retry with a reason code', async () => {
    const { repository, prisma } = harness();

    await expect(repository.failWebhookClaim({
      webhookId: 'webhook-1',
      leaseOwnerHash: 'owner-hash',
      errorCode: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
      maxAttempts: 3,
      retryable: true,
    })).resolves.toBeUndefined();
    expect(prisma.paymentWebhookEvent.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'webhook-1',
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: 'owner-hash',
        processingLeaseExpiresAt: { gt: expect.any(Date) },
      },
      select: { processingAttempts: true, resultCode: true },
    });
    expect(prisma.paymentWebhookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'webhook-1',
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: 'owner-hash',
        processingLeaseExpiresAt: { gt: expect.any(Date) },
      },
      data: expect.objectContaining({
        processedStatus: 'FAILED',
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        retryable: true,
        lastErrorCode: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
      }),
    });
  });

  it('closes an exhausted claim via failWebhookClaim without a blind retry', async () => {
    const { repository, prisma } = harness();
    prisma.paymentWebhookEvent.findFirst.mockResolvedValueOnce({ processingAttempts: 3, resultCode: null });

    await expect(repository.failWebhookClaim({
      webhookId: 'webhook-1',
      leaseOwnerHash: 'owner-hash',
      errorCode: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
      maxAttempts: 3,
      retryable: true,
    })).resolves.toBeUndefined();
    expect(prisma.paymentWebhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        processedStatus: 'FAILED',
        retryable: false,
        nextRetryAt: null,
        resultCode: 'PROCESSING_ATTEMPTS_EXHAUSTED',
      }),
    }));
  });

  it('throws PAYMENT_WEBHOOK_CLAIM_LOST when failWebhookClaim finds no owned, fresh lease', async () => {
    const { repository, prisma } = harness();
    prisma.paymentWebhookEvent.findFirst.mockResolvedValueOnce(null);

    await expect(repository.failWebhookClaim({
      webhookId: 'webhook-1',
      leaseOwnerHash: 'stale-owner',
      errorCode: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
      maxAttempts: 3,
      retryable: true,
    })).rejects.toThrow('PAYMENT_WEBHOOK_CLAIM_LOST');
    expect(prisma.paymentWebhookEvent.updateMany).not.toHaveBeenCalled();
  });
});
