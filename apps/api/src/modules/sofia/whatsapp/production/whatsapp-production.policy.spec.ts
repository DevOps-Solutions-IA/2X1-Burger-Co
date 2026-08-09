import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { UnknownCommandResultError } from '../../../secure-command/secure-command.errors';
import type { CommandRecord } from '../../../secure-command/secure-command.types';
import { WhatsappDeliveryStatusService } from './whatsapp-delivery-status.service';
import { WhatsappHandoffService } from './whatsapp-handoff.service';
import { WhatsappInboundDeduplicator } from './whatsapp-inbound-deduplicator';
import { WhatsappOutboundCommandHandler } from './whatsapp-outbound-command.handler';
import type { WhatsappProductionRepository } from './whatsapp-production.repository';

describe('WhatsApp production policy services', () => {
  it('returns deterministic replay without a second claim', async () => {
    const claimInbound = jest.fn()
      .mockResolvedValueOnce({
        id: 'event-row', created: true, disposition: 'ACQUIRED', attempt: 1, claimToken: 'claim-token',
        leaseExpiresAt: new Date(Date.now() + 60_000), processingStatus: 'CLAIMED', deterministicResult: null,
      })
      .mockResolvedValueOnce({ id: 'event-row', created: false, processingStatus: 'PROCESSED', deterministicResult: { code: 'OK' } });
    const service = new WhatsappInboundDeduplicator({ claimInbound } as unknown as WhatsappProductionRepository);
    const event = {
      kind: 'INBOUND_MESSAGE' as const,
      provider: 'qr_gateway' as const,
      account: { provider: 'qr_gateway' as const, externalAccountId: 'a', businessIdentity: 'b', sessionOwner: 's' },
      eventId: 'event-1', messageId: 'message-1', sender: '573001234567', senderIdentityHash: 'sender',
      recipientIdentityHash: 'recipient', messageType: 'TEXT' as const, sanitizedText: 'hola', media: null,
      occurredAt: new Date(), payloadHash: 'payload',
    };

    await expect(service.claim(event, 'account-1')).resolves.toMatchObject({ state: 'CLAIMED' });
    await expect(service.claim(event, 'account-1')).resolves.toMatchObject({
      state: 'DETERMINISTIC_REPLAY', replay: { code: 'OK' }, inboundEventId: 'event-row',
    });
  });

  it('blocks stale handoff transitions and release while governance is paused', async () => {
    const repository = {
      conversationPolicyState: jest.fn().mockResolvedValue({
        customerId: 'customer-1', status: 'ACTIVE', humanStatus: 'HUMAN_TAKEN', sofiaEnabled: false,
        assignedToUserId: 'operator-1', handoffVersion: 4,
      }),
      transitionHandoff: jest.fn(),
    };
    const consent = { evaluate: jest.fn().mockResolvedValue({ allowed: true, reasonCode: 'CONSENT_GRANTED' }) };
    const safety = { getState: jest.fn().mockResolvedValue({ globalPaused: true, killSwitchActive: false }) };
    const service = new WhatsappHandoffService(repository as unknown as WhatsappProductionRepository, consent as never, safety as never);

    await expect(service.transition({
      conversationId: 'conversation-1', actorId: 'operator-1', target: 'SOFIA_ACTIVE', reasonCode: 'RELEASE', expectedVersion: 3,
    })).rejects.toMatchObject({ response: { code: 'WHATSAPP_HANDOFF_VERSION_CONFLICT' } });
    await expect(service.transition({
      conversationId: 'conversation-1', actorId: 'operator-1', target: 'SOFIA_ACTIVE', reasonCode: 'RELEASE', expectedVersion: 4,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.transitionHandoff).not.toHaveBeenCalled();
  });

  it('delegates identical stale replays to the atomic repository decision', async () => {
    const repository = {
      conversationPolicyState: jest.fn().mockResolvedValue({
        customerId: 'customer-1', status: 'HUMAN_TAKEN', humanStatus: 'HUMAN_TAKEN', sofiaEnabled: false,
        assignedToUserId: 'operator-1', handoffVersion: 5,
      }),
      transitionHandoff: jest.fn().mockResolvedValue({
        state: 'HUMAN_TAKEN', version: 5, assignedActorId: 'operator-1', replayed: true,
      }),
    };
    const service = new WhatsappHandoffService(
      repository as unknown as WhatsappProductionRepository,
      { evaluate: jest.fn() } as never,
      { getState: jest.fn() } as never,
    );

    await expect(service.transition({
      conversationId: 'conversation-1', actorId: 'operator-1', target: 'HUMAN_TAKEN',
      reasonCode: 'OPERATOR_TAKEOVER', expectedVersion: 4, assignedToUserId: 'operator-1',
    })).resolves.toMatchObject({ version: 5, replayed: true });
    expect(repository.transitionHandoff).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 4,
      previousState: 'HUMAN_TAKEN',
    }));
  });

  it('rejects delivery status regressions', async () => {
    const repository = {
      latestStatus: jest.fn().mockResolvedValue('DELIVERED'),
      appendStatus: jest.fn(),
    };
    const service = new WhatsappDeliveryStatusService(repository as unknown as WhatsappProductionRepository);
    await expect(service.apply({
      accountId: 'account-1', providerStatusEventId: 'status-1', providerMessageId: 'provider-message-1',
      recipientIdentityHash: 'recipient', status: 'SENT', occurredAt: new Date(), payloadHash: 'payload',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.appendStatus).not.toHaveBeenCalled();
  });

  it('keeps the secure outbound handler operationally disabled', async () => {
    const repository = { outboundForCommand: jest.fn() };
    const handler = new WhatsappOutboundCommandHandler(
      { get: () => false } as unknown as ConfigService,
      repository as unknown as WhatsappProductionRepository,
      {} as never,
      {} as never,
    );
    await expect(handler.execute({ commandType: 'SOFIA_SEND_WHATSAPP' } as CommandRecord)).rejects.toMatchObject({
      response: { code: 'SOFIA_COMMAND_POLICY_BLOCKED' },
    });
    expect(repository.outboundForCommand).not.toHaveBeenCalled();
  });

  it('propagates an unknown provider result as a terminal secure-command outcome', async () => {
    const outbound = {
      id: 'outbound-1',
      conversationId: 'conversation-1',
      recipientIdentityHash: createHash('sha256').update('573001234567').digest('hex'),
      purpose: 'SERVICE',
      body: 'Tu pedido esta listo.',
      mediaUrl: null,
      accountId: 'account-1',
      idempotencyKey: 'send-1',
      conversation: { phone: '573001234567', customerId: 'customer-1', handoffVersion: 4 },
      account: { provider: 'qr_gateway', status: 'VERIFIED_RECEIVE_ONLY' },
    };
    const payload = {
      outboundMessageId: outbound.id,
      conversationId: outbound.conversationId,
      recipientIdentityHash: outbound.recipientIdentityHash,
      purpose: outbound.purpose,
      bodyHash: createHash('sha256').update(outbound.body).digest('hex'),
      accountId: outbound.accountId,
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))))
      .digest('hex');
    const repository = {
      outboundForCommand: jest.fn().mockResolvedValue(outbound),
      bindOutboundCommand: jest.fn().mockResolvedValue(undefined),
      completeOutbound: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new WhatsappOutboundCommandHandler(
      { get: (key: string) => key === 'SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED' ? true : 'qr_gateway' } as unknown as ConfigService,
      repository as unknown as WhatsappProductionRepository,
      { outbound: jest.fn().mockResolvedValue(undefined) } as never,
      { send: jest.fn().mockResolvedValue({ code: 'WHATSAPP_UNKNOWN_RESULT', unknownResult: true }) } as never,
    );

    await expect(handler.execute({
      id: 'command-1',
      commandType: 'SOFIA_SEND_WHATSAPP',
      targetId: outbound.id,
      expectedVersion: '4',
      payloadHash,
    } as CommandRecord)).rejects.toEqual(new UnknownCommandResultError('WHATSAPP_UNKNOWN_RESULT'));
    expect(repository.completeOutbound).toHaveBeenCalledWith(expect.objectContaining({
      outboundMessageId: outbound.id,
      status: 'UNKNOWN_RESULT',
      unknownResult: true,
      errorCode: 'WHATSAPP_UNKNOWN_RESULT',
    }));
  });
});
