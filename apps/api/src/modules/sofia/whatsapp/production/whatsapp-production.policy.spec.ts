import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
});
