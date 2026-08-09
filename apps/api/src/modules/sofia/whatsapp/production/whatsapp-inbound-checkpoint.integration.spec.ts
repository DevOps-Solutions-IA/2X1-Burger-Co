import { WhatsappInboundEventKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';

const describeDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDatabase('WhatsApp inbound checkpoint PostgreSQL recovery', () => {
  const prisma = new PrismaService();
  const repository = new PrismaWhatsappProductionRepository(prisma, {} as never);
  const namespace = randomUUID();
  let accountId: string;

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
  });

  afterAll(async () => {
    await prisma.whatsappInboundEvent.deleteMany({ where: { accountId } });
    await prisma.whatsappProviderAccount.delete({ where: { id: accountId } });
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
});
