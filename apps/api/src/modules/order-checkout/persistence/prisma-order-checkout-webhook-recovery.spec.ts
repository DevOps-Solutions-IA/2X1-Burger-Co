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

  function harness(existing: unknown[] = []) {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ pg_advisory_xact_lock: null }])
        .mockResolvedValueOnce(existing),
      $executeRaw: jest.fn().mockResolvedValue(1),
      paymentWebhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'webhook-1', paymentIntentId: 'intent-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps pre-migration incomplete financial evidence blocked for incident review', async () => {
    const { repository, tx } = harness([row({ processingAttempts: 0 })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'BLOCKED',
      webhookId: 'webhook-1',
      reasonCode: 'LEGACY_AMBIGUOUS',
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('closes an exhausted claim instead of retrying it again', async () => {
    const { repository, tx } = harness([row({ processingAttempts: 3 })]);

    await expect(repository.claimWebhookEvidence(evidence)).resolves.toEqual({
      state: 'BLOCKED',
      webhookId: 'webhook-1',
      reasonCode: 'ATTEMPTS_EXHAUSTED',
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    prisma.$executeRaw.mockResolvedValueOnce(0);
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
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
