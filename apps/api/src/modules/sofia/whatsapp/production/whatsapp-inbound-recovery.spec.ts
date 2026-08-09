import { WhatsappInboundEventKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';
import { normalizeWhatsappInboundClaimInput } from './whatsapp-inbound-contracts';
import { WhatsappInboundDeduplicator } from './whatsapp-inbound-deduplicator';
import type { WhatsappProductionRepository } from './whatsapp-production.repository';

const input = {
  accountId: ' account-1 ',
  provider: 'qr_gateway',
  eventId: ' event-1 ',
  messageId: ' message-1 ',
  phone: '300 123 4567',
  eventHash: ' event-hash ',
  eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
  normalizedPayloadHash: ' payload-hash ',
};

function duplicateError() {
  return Object.assign(new Error('duplicate'), { code: 'P2002' });
}

function repositoryWith(inbound: Record<string, jest.Mock>) {
  const prisma = { whatsappInboundEvent: inbound };
  return new PrismaWhatsappProductionRepository(prisma as never, {} as never);
}

function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    accountId: 'account-1',
    provider: 'qr_gateway',
    providerEventId: 'event-1',
    eventHash: 'event-hash',
    processingStatus: 'CLAIMED',
    processingAttempts: 1,
    processingLeaseExpiresAt: new Date(Date.now() + 60_000),
    nextRetryAt: null,
    retryable: true,
    deterministicResult: null,
    ...overrides,
  };
}

describe('WhatsApp inbound leased recovery', () => {
  it('normalizes the persistence contract before claiming', () => {
    expect(normalizeWhatsappInboundClaimInput(input)).toEqual({
      accountId: 'account-1',
      provider: 'qr_gateway',
      eventId: 'event-1',
      messageId: 'message-1',
      phone: '573001234567',
      eventHash: 'event-hash',
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: 'payload-hash',
    });
    expect(() => normalizeWhatsappInboundClaimInput({ ...input, eventId: '\u0000event' })).toThrow(
      'WHATSAPP_EVENT_ID_INVALID',
    );
  });

  it('namespaces new provider identities by provider and account without exposing raw ids', async () => {
    const inbound = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'row-scoped', processingStatus: 'CLAIMED' }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      id: 'row-scoped',
      disposition: 'ACQUIRED',
    });
    expect(inbound.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'qr_gateway',
        accountId: 'account-1',
        providerEventId: expect.stringMatching(/^v2:[a-f0-9]{64}$/),
        eventHash: expect.stringMatching(/^v2:[a-f0-9]{64}$/),
      }),
    }));
    expect(inbound.create.mock.calls[0]?.[0].data.providerEventId).not.toBe('event-1');
    expect(inbound.create.mock.calls[0]?.[0].data.eventHash).not.toBe('event-hash');
  });

  it('returns in-progress without granting a second active lease', async () => {
    const inbound = {
      create: jest.fn().mockRejectedValue(duplicateError()),
      findFirst: jest.fn().mockResolvedValue(existing()),
      updateMany: jest.fn(),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      id: 'row-1',
      disposition: 'IN_PROGRESS',
      attempt: 1,
      claimToken: null,
      deterministicResult: null,
    });
    expect(inbound.updateMany).not.toHaveBeenCalled();
  });

  it('recovers an expired lease once with a new token and incremented attempt', async () => {
    const inbound = {
      create: jest.fn().mockRejectedValue(duplicateError()),
      findFirst: jest.fn().mockResolvedValue(existing({ processingLeaseExpiresAt: new Date(Date.now() - 1) })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const repository = repositoryWith(inbound);

    const claim = await repository.claimInbound(input);
    expect(claim).toMatchObject({ disposition: 'ACQUIRED', created: false, attempt: 2 });
    expect(claim.claimToken).toEqual(expect.any(String));
    expect(claim.claimToken).not.toBe('claim-1');
    expect(inbound.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'row-1', processingStatus: 'CLAIMED' }),
      data: expect.objectContaining({ errorMessage: null }),
    }));
  });

  it('recovers a fenced conversational checkpoint without losing it', async () => {
    const checkpoint = {
      kind: 'SOFIA_CONVERSATION_RESULT_V1',
      eventHash: 'event-hash',
      conversationId: 'conversation-1',
      inboundMessageId: 'message-1',
    };
    const inbound = {
      create: jest.fn().mockRejectedValue(duplicateError()),
      findFirst: jest.fn().mockResolvedValue(existing({
        processingLeaseExpiresAt: new Date(Date.now() - 1),
        deterministicResult: checkpoint,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      disposition: 'ACQUIRED',
      attempt: 2,
      deterministicResult: checkpoint,
    });
    expect(inbound.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('deterministicResult');
  });

  it('observes the winning lease when a concurrent recovery wins the CAS', async () => {
    const expired = existing({ processingLeaseExpiresAt: new Date(Date.now() - 1) });
    const active = existing({
      processingAttempts: 2,
      processingLeaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const inbound = {
      create: jest.fn().mockRejectedValue(duplicateError()),
      findFirst: jest.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(active),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      disposition: 'IN_PROGRESS',
      attempt: 2,
      claimToken: null,
    });
  });

  it('terminally exhausts the third expired attempt and replays its bounded receipt', async () => {
    const terminal = {
      processingStatus: 'ATTEMPTS_EXHAUSTED',
      reasonCode: 'WHATSAPP_INBOUND_ATTEMPTS_EXHAUSTED',
      attempts: 3,
    };
    const inbound = {
      create: jest.fn().mockRejectedValue(duplicateError()),
      findFirst: jest.fn()
        .mockResolvedValueOnce(existing({
          processingAttempts: 3,
          processingLeaseExpiresAt: new Date(Date.now() - 1),
        }))
        .mockResolvedValueOnce(existing({
          processingStatus: 'ATTEMPTS_EXHAUSTED',
          processingAttempts: 3,
          processingLeaseExpiresAt: null,
          retryable: false,
          deterministicResult: terminal,
        })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      disposition: 'ATTEMPTS_EXHAUSTED',
      deterministicResult: terminal,
    });
    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      disposition: 'ATTEMPTS_EXHAUSTED',
      deterministicResult: terminal,
    });
  });

  it('completes only the owned lease and leaves terminal results immutable', async () => {
    const inbound = {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }),
      findUnique: jest.fn()
        .mockResolvedValueOnce({ processingStatus: 'CLAIMED' })
        .mockResolvedValueOnce({ processingStatus: 'PROCESSED' }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.completeInbound('row-1', 'PROCESSED', { code: 'OK' }, null, 'stale')).rejects.toThrow(
      'WHATSAPP_INBOUND_LEASE_LOST',
    );
    await expect(repository.completeInbound('row-1', 'FAILED', { code: 'FAILED' }, null, 'stale')).resolves.toBeUndefined();
    expect(inbound.updateMany.mock.calls[0]?.[0].where).toEqual(expect.objectContaining({
      processingLeaseOwnerHash: createHash('sha256').update('stale').digest('hex'),
    }));
  });

  it('checkpoints only the live owned lease and preserves it on retryable failure', async () => {
    const checkpoint = { kind: 'SOFIA_CONVERSATION_RESULT_V1', responseText: 'Respuesta segura.' };
    const inbound = {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }),
      findUnique: jest.fn(),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.checkpointInbound('row-1', checkpoint, 'lease-token')).resolves.toBeUndefined();
    await expect(
      repository.completeInbound('row-1', 'FAILED', { processingStatus: 'FAILED' }, 'CRASH', 'lease-token'),
    ).resolves.toBeUndefined();

    expect(inbound.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        processingLeaseOwnerHash: createHash('sha256').update('lease-token').digest('hex'),
      }),
      data: { deterministicResult: checkpoint },
    }));
    expect(inbound.updateMany.mock.calls[1]?.[0].data).toEqual(expect.objectContaining({
      processingStatus: 'FAILED',
      deterministicResult: undefined,
      retryable: true,
    }));
  });

  it('renews only the live owned lease and fences stale workers', async () => {
    const inbound = {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ processingStatus: 'CLAIMED' }),
    };
    const repository = repositoryWith(inbound);

    await expect(repository.renewInboundLease('row-1', 'lease-token')).resolves.toBeInstanceOf(Date);
    await expect(repository.renewInboundLease('row-1', 'stale-token')).rejects.toThrow(
      'WHATSAPP_INBOUND_LEASE_LOST',
    );
    expect(inbound.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        processingStatus: 'CLAIMED',
        processingLeaseOwnerHash: createHash('sha256').update('lease-token').digest('hex'),
        processingLeaseExpiresAt: { gt: expect.any(Date) },
      }),
      data: { processingLeaseExpiresAt: expect.any(Date) },
    }));
  });

  it('passes each acquired lease token through its immutable completion context', async () => {
    const completeInbound = jest.fn().mockResolvedValue(undefined);
    const repository = {
      claimInbound: jest.fn()
        .mockResolvedValueOnce({
          id: 'row-1', created: true, disposition: 'ACQUIRED', attempt: 1, claimToken: 'lease-token-a',
          leaseExpiresAt: new Date(), processingStatus: 'CLAIMED', deterministicResult: null,
        })
        .mockResolvedValueOnce({
          id: 'row-1', created: false, disposition: 'ACQUIRED', attempt: 2, claimToken: 'lease-token-b',
          leaseExpiresAt: new Date(), processingStatus: 'CLAIMED', deterministicResult: null,
        }),
      completeInbound,
    };
    const deduplicator = new WhatsappInboundDeduplicator(repository as unknown as WhatsappProductionRepository);
    const event = {
      kind: 'UNSUPPORTED_EVENT' as const,
      provider: 'qr_gateway' as const,
      account: { provider: 'qr_gateway' as const, externalAccountId: 'a', businessIdentity: 'b', sessionOwner: 's' },
      eventId: 'event-1', reasonCode: 'UNSUPPORTED', occurredAt: new Date(), payloadHash: 'payload',
    };

    const first = await deduplicator.claim(event, 'account-1');
    const recovered = await deduplicator.claim(event, 'account-1');
    if (first.state !== 'CLAIMED' || recovered.state !== 'CLAIMED') throw new Error('expected acquired claims');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(recovered)).toBe(true);

    await deduplicator.complete(first, 'PROCESSED', { worker: 'A' });
    await deduplicator.complete(recovered, 'PROCESSED', { worker: 'B' });

    expect(completeInbound).toHaveBeenNthCalledWith(1, 'row-1', 'PROCESSED', { worker: 'A' }, undefined, 'lease-token-a');
    expect(completeInbound).toHaveBeenNthCalledWith(2, 'row-1', 'PROCESSED', { worker: 'B' }, undefined, 'lease-token-b');
  });
});
