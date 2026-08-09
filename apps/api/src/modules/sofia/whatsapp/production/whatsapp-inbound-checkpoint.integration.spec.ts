import { WhatsappInboundEventKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../../audit/audit.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PrismaWhatsappConversationRepository } from './persistence/prisma-whatsapp-conversation.repository';
import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';
import { WhatsappConsentService } from './whatsapp-consent.service';
import { WhatsappHandoffService } from './whatsapp-handoff.service';
import { WhatsappInboundRecoveryWorker } from './whatsapp-inbound-recovery.worker';

const describeDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDatabase('WhatsApp inbound checkpoint PostgreSQL recovery', () => {
  const prisma = new PrismaService();
  const audit = new AuditService(prisma, { current: () => null } as never);
  const repository = new PrismaWhatsappProductionRepository(prisma, audit);
  const conversations = new PrismaWhatsappConversationRepository(prisma);
  const namespace = randomUUID();
  let accountId: string;
  const accountIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await prisma.$connect();
    const account = await prisma.whatsappProviderAccount.create({
      data: {
        provider: 'qr_gateway',
        externalAccountHash: `account-${namespace}`,
        businessIdentityHash: `business-${namespace}`,
        sessionOwnerHash: `session-${namespace}`,
        status: 'VERIFIED_RECEIVE_ONLY',
      },
    });
    accountId = account.id;
    accountIds.push(account.id);
  });

  afterAll(async () => {
    await prisma.whatsappInboundEvent.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.whatsappProviderAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it('reclaims the same checkpoint and fences the expired worker', async () => {
    const input = {
      accountId,
      provider: 'qr_gateway',
      eventId: `event-${namespace}`,
      messageId: `message-${namespace}`,
      phone: '573001234567',
      eventHash: `event-hash-${namespace}`,
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: `payload-hash-${namespace}`,
    };
    const first = await repository.claimInbound(input);
    expect(first).toMatchObject({ disposition: 'ACQUIRED', attempt: 1, deterministicResult: null });
    expect(first.claimToken).toEqual(expect.any(String));

    const checkpoint = {
      kind: 'SOFIA_CONVERSATION_RESULT_V1',
      eventHash: input.eventHash,
      conversationId: 'conversation-1',
      inboundMessageId: 'inbound-message-1',
      mode: 'receive_only',
      provider: 'qr_gateway',
      responseText: 'Respuesta comercial segura.',
      confidence: 0.95,
      businessOpen: true,
      shouldHandoff: false,
      handoffApplied: false,
      mediaUrl: null,
      outboundStatus: 'SUGGESTED',
    };
    await repository.checkpointInbound(first.id, checkpoint, first.claimToken!);
    const renewedUntil = await repository.renewInboundLease(first.id, first.claimToken!);
    expect(renewedUntil.getTime()).toBeGreaterThan(Date.now());
    await prisma.whatsappInboundEvent.update({
      where: { id: first.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1) },
    });

    const recovered = await repository.claimInbound(input);
    expect(recovered).toMatchObject({
      id: first.id,
      disposition: 'ACQUIRED',
      attempt: 2,
      deterministicResult: checkpoint,
    });
    await expect(
      repository.checkpointInbound(first.id, { poisoned: true }, first.claimToken!),
    ).rejects.toThrow('WHATSAPP_INBOUND_LEASE_LOST');

    const receipt = { processingStatus: 'SUGGESTED', inboundEventId: first.id };
    await repository.completeInbound(first.id, 'SUGGESTED', receipt, null, recovered.claimToken!);
    await expect(repository.claimInbound(input)).resolves.toMatchObject({
      disposition: 'DETERMINISTIC_REPLAY',
      deterministicResult: receipt,
    });
    const persisted = await prisma.whatsappInboundEvent.findUniqueOrThrow({ where: { id: first.id } });
    expect(persisted.processingAttempts).toBe(2);
    expect(JSON.stringify(persisted.rawPayload)).toBe('{"redacted":true}');
    expect(JSON.stringify(persisted.deterministicResult)).not.toContain('provider-secret');
  });

  it('isolates identical provider ids across accounts and replays legacy unscoped evidence', async () => {
    const accounts = await Promise.all([
      prisma.whatsappProviderAccount.create({
        data: {
          provider: 'qr_gateway',
          externalAccountHash: `scoped-qr-${namespace}`,
          businessIdentityHash: `scoped-qr-business-${namespace}`,
          sessionOwnerHash: `scoped-qr-session-${namespace}`,
          status: 'VERIFIED_RECEIVE_ONLY',
        },
      }),
      prisma.whatsappProviderAccount.create({
        data: {
          provider: 'qr_gateway',
          externalAccountHash: `scoped-qr-second-${namespace}`,
          businessIdentityHash: `scoped-qr-second-business-${namespace}`,
          sessionOwnerHash: `scoped-qr-second-session-${namespace}`,
          status: 'VERIFIED_RECEIVE_ONLY',
        },
      }),
      prisma.whatsappProviderAccount.create({
        data: {
          provider: 'qr_gateway',
          externalAccountHash: `legacy-qr-${namespace}`,
          businessIdentityHash: `legacy-qr-business-${namespace}`,
          sessionOwnerHash: `legacy-qr-session-${namespace}`,
          status: 'VERIFIED_RECEIVE_ONLY',
        },
      }),
    ]);
    accountIds.push(...accounts.map(({ id }) => id));
    const shared = {
      eventId: `shared-provider-event-${namespace}`,
      messageId: `shared-message-${namespace}`,
      phone: '573001234567',
      eventHash: `shared-event-hash-${namespace}`,
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: `shared-payload-hash-${namespace}`,
    };

    const [firstAccountClaim, secondAccountClaim] = await Promise.all([
      repository.claimInbound({ ...shared, accountId: accounts[0]!.id, provider: 'qr_gateway' }),
      repository.claimInbound({ ...shared, accountId: accounts[1]!.id, provider: 'qr_gateway' }),
    ]);
    expect(firstAccountClaim.id).not.toBe(secondAccountClaim.id);
    await Promise.all([
      repository.completeInbound(firstAccountClaim.id, 'PROCESSED', { code: 'FIRST_ACCOUNT_OK' }, null, firstAccountClaim.claimToken!),
      repository.completeInbound(secondAccountClaim.id, 'PROCESSED', { code: 'SECOND_ACCOUNT_OK' }, null, secondAccountClaim.claimToken!),
    ]);
    await expect(repository.claimInbound({
      ...shared,
      accountId: accounts[0]!.id,
      provider: 'qr_gateway',
    })).resolves.toMatchObject({ id: firstAccountClaim.id, disposition: 'DETERMINISTIC_REPLAY' });

    const legacyInput = {
      ...shared,
      accountId: accounts[2]!.id,
      provider: 'qr_gateway' as const,
      eventId: `legacy-provider-event-${namespace}`,
      eventHash: `legacy-event-hash-${namespace}`,
    };
    const legacy = await prisma.whatsappInboundEvent.create({
      data: {
        accountId: legacyInput.accountId,
        provider: legacyInput.provider,
        providerEventId: legacyInput.eventId,
        providerMessageId: legacyInput.messageId,
        phone: legacyInput.phone,
        eventHash: legacyInput.eventHash,
        normalizedPayloadHash: legacyInput.normalizedPayloadHash,
        eventKind: legacyInput.eventKind,
        processingStatus: 'PROCESSED',
        deterministicResult: { code: 'LEGACY_OK' },
      },
    });
    await expect(repository.claimInbound(legacyInput)).resolves.toMatchObject({
      id: legacy.id,
      disposition: 'DETERMINISTIC_REPLAY',
      deterministicResult: { code: 'LEGACY_OK' },
    });
  });

  it('autonomously fences an abandoned claim without re-running conversational work', async () => {
    const input = {
      accountId,
      provider: 'qr_gateway' as const,
      eventId: `abandoned-event-${namespace}`,
      messageId: `abandoned-message-${namespace}`,
      phone: '573009999999',
      eventHash: `abandoned-hash-${namespace}`,
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: `abandoned-payload-${namespace}`,
    };
    const claim = await repository.claimInbound(input);
    await prisma.whatsappInboundEvent.update({
      where: { id: claim.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1) },
    });
    const handoff = { transition: jest.fn() };
    const worker = new WhatsappInboundRecoveryWorker(repository, conversations, handoff as never);

    await worker.runOnce(new Date());

    const recovered = await prisma.whatsappInboundEvent.findUniqueOrThrow({ where: { id: claim.id } });
    expect(recovered).toMatchObject({
      processingStatus: 'FAILED',
      retryable: true,
      processingLeaseOwnerHash: null,
      processingLeaseExpiresAt: null,
      lastErrorCode: 'WHATSAPP_INBOUND_WORKER_DIED',
    });
    expect(recovered.deterministicResult).toEqual(expect.objectContaining({
      kind: 'WHATSAPP_INBOUND_ABANDONED_V1',
      handoffRequired: true,
      handoffApplied: true,
      handoffOutcome: 'CONVERSATION_NOT_FOUND',
    }));
    expect(handoff.transition).not.toHaveBeenCalled();
  });

  it('persists one real handoff event for an abandoned claim with a valid system actor', async () => {
    const phone = '573008888888';
    const conversation = await prisma.whatsappConversation.create({
      data: {
        phone,
        provider: 'qr_gateway',
        mode: 'receive_only',
        status: 'ACTIVE',
        humanStatus: 'SOFIA_ACTIVE',
        sofiaEnabled: true,
      },
    });
    const input = {
      accountId,
      provider: 'qr_gateway' as const,
      eventId: `abandoned-conversation-event-${namespace}`,
      messageId: `abandoned-conversation-message-${namespace}`,
      phone,
      eventHash: `abandoned-conversation-hash-${namespace}`,
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: `abandoned-conversation-payload-${namespace}`,
    };
    const claim = await repository.claimInbound(input);
    await prisma.whatsappInboundEvent.update({
      where: { id: claim.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1) },
    });
    const consent = new WhatsappConsentService(repository);
    const handoff = new WhatsappHandoffService(
      repository,
      consent,
      { getState: jest.fn().mockResolvedValue({ globalPaused: false, killSwitchActive: false }) } as never,
    );
    const worker = new WhatsappInboundRecoveryWorker(repository, conversations, handoff);

    await worker.runOnce(new Date());
    await worker.runOnce(new Date());

    const [recovered, updatedConversation, handoffEvents] = await Promise.all([
      prisma.whatsappInboundEvent.findUniqueOrThrow({ where: { id: claim.id } }),
      prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      prisma.whatsappHandoffEvent.findMany({ where: { conversationId: conversation.id } }),
    ]);
    expect(recovered.deterministicResult).toEqual(expect.objectContaining({
      kind: 'WHATSAPP_INBOUND_ABANDONED_V1',
      handoffApplied: true,
      handoffOutcome: 'HUMAN_REQUIRED',
    }));
    expect(updatedConversation).toMatchObject({
      status: 'HUMAN_REQUIRED',
      humanStatus: 'HUMAN_REQUIRED',
      sofiaEnabled: false,
      handoffVersion: 1,
    });
    expect(handoffEvents).toHaveLength(1);
    expect(handoffEvents[0]).toMatchObject({
      actorId: 'sofia-whatsapp-inbound-recovery',
      version: 1,
    });
    await expect(prisma.user.findUniqueOrThrow({
      where: { id: handoffEvents[0]!.actorId },
    })).resolves.toMatchObject({
      email: 'sofia-whatsapp-inbound-recovery@system.invalid',
      isActive: false,
    });
    await expect(prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: 'sofia-whatsapp-inbound-recovery',
        action: 'WHATSAPP_HANDOFF_TRANSITION',
      },
    })).resolves.toMatchObject({ actorType: 'SYSTEM', userId: null });
  });
});
