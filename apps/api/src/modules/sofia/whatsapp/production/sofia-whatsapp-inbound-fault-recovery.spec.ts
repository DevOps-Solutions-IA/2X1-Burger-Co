import type { WhatsappInboundClaimContext } from './whatsapp-production.repository';
import { SofiaWhatsappService } from '../../sofia-whatsapp.service';

const parsed = {
  provider: 'qr_gateway' as const,
  providerEventId: 'provider-event-1',
  providerMessageId: 'provider-message-1',
  providerConversationId: 'provider-conversation-1',
  phone: '573001234567',
  customerName: 'Cliente',
  body: 'Quiero un combo',
  transcript: null,
  mediaUrl: null,
  mediaMimeType: null,
  messageType: 'TEXT' as const,
  timestamp: new Date('2026-08-09T10:00:00.000Z'),
  rawPayload: { mustNeverBeCheckpointed: 'provider-secret-material' },
};

function claim(recoveryCheckpoint: unknown): WhatsappInboundClaimContext {
  return Object.freeze({
    inboundEventId: 'inbound-event-1',
    claimToken: 'lease-token',
    attempt: recoveryCheckpoint ? 2 : 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    recoveryCheckpoint,
  });
}

describe('Sofia WhatsApp conversational checkpoint recovery', () => {
  it('recovers after the agent checkpoint without repeating agent, draft, handoff, or audit effects', async () => {
    let durableCheckpoint: unknown = null;
    const effects = { draft: 0, audit: 0 };
    const conversations = {
      findConversation: jest.fn()
        .mockResolvedValueOnce({
          id: 'conversation-1',
          customerId: null,
          sofiaEnabled: true,
          status: 'ACTIVE',
          humanStatus: 'SOFIA_ACTIVE',
          phone: '573001234567',
        })
        .mockResolvedValue({
          id: 'conversation-1',
          customerId: null,
          sofiaEnabled: false,
          status: 'HUMAN_REQUIRED',
          humanStatus: 'HUMAN_REQUIRED',
          phone: '573001234567',
        }),
      findSystemActorId: jest.fn().mockResolvedValue('system-actor'),
      findOutboundByIdempotency: jest.fn().mockResolvedValue(null),
      createOutbound: jest.fn().mockResolvedValue({ id: 'outbound-1', status: 'SUGGESTED' }),
    };
    const inboundGateway = {
      checkpoint: jest.fn().mockImplementation(async (_claim, checkpointValue) => {
        durableCheckpoint = checkpointValue;
      }),
      renew: jest.fn().mockResolvedValue(new Date(Date.now() + 120_000)),
    };
    const handoff = {
      decision: jest.fn().mockResolvedValue({ state: 'SOFIA_ACTIVE' }),
      transition: jest.fn(),
    };
    const agent = {
      processInboundMessage: jest.fn().mockImplementation(async () => {
        effects.draft += 1;
        effects.audit += 1;
        return {
          responseText: 'Perfecto, estoy validando tu borrador.',
          confidence: 0.95,
          shouldHandoff: true,
          mediaSuggestion: null,
          businessStatus: { isOpen: true },
        };
      }),
    };
    const service = new SofiaWhatsappService(
      conversations as never,
      {
        isAutoReplyAllowed: jest.fn().mockReturnValue(false),
      } as never,
      agent as never,
      { evaluate: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      {} as never,
      inboundGateway as never,
      { identityHash: jest.fn().mockReturnValue('recipient-hash') } as never,
      { inbound: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      handoff as never,
      {} as never,
    );
    const privateService = service as unknown as {
      handleInboundMode(input: Record<string, unknown>): Promise<unknown>;
      afterInboundConversationCheckpoint(): void;
    };
    jest.spyOn(privateService, 'afterInboundConversationCheckpoint')
      .mockImplementationOnce(() => {
        throw new Error('FAULT_AFTER_AGENT_CHECKPOINT');
      });

    const baseInput = {
      mode: 'receive_only',
      providerName: 'qr_gateway',
      parsed,
      conversationId: 'conversation-1',
      inboundMessageId: 'inbound-message-1',
      accountId: 'account-1',
      headers: {},
      eventHash: 'event-hash-1',
    };

    await expect(privateService.handleInboundMode({ ...baseInput, claim: claim(null) }))
      .rejects.toThrow('FAULT_AFTER_AGENT_CHECKPOINT');
    expect(agent.processInboundMessage).toHaveBeenCalledTimes(1);
    expect(effects).toEqual({ draft: 1, audit: 1 });
    expect(handoff.transition).not.toHaveBeenCalled();
    expect(JSON.stringify(durableCheckpoint)).not.toContain('mustNeverBeCheckpointed');
    expect(JSON.stringify(durableCheckpoint)).not.toContain('provider-secret-material');

    await expect(
      privateService.handleInboundMode({ ...baseInput, claim: claim(durableCheckpoint) }),
    ).resolves.toMatchObject({
      processingStatus: 'SUGGESTED',
      outbound: { id: 'outbound-1', status: 'SUGGESTED' },
      sofiaResult: null,
    });

    expect(agent.processInboundMessage).toHaveBeenCalledTimes(1);
    expect(effects).toEqual({ draft: 1, audit: 1 });
    expect(handoff.transition).toHaveBeenCalledTimes(1);
    expect(handoff.transition).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      target: 'HUMAN_REQUIRED',
      reasonCode: 'SOFIA_SAFE_HANDOFF',
    }));
    expect((service as never as { runtimeSafetyService: { evaluate: jest.Mock } }).runtimeSafetyService.evaluate)
      .toHaveBeenCalledTimes(1);
    expect(conversations.createOutbound).toHaveBeenCalledTimes(1);
    expect(inboundGateway.checkpoint).toHaveBeenCalledTimes(3);
  });

  it('fails closed when a worker loses its lease during the agent without a second conversational execution', async () => {
    jest.useFakeTimers();
    let startedCheckpoint: unknown = null;
    let resolveAgent!: (value: Record<string, unknown>) => void;
    const agentResult = new Promise<Record<string, unknown>>((resolve) => {
      resolveAgent = resolve;
    });
    const effects = { draft: 0, audit: 0 };
    const conversations = {
      findConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1', customerId: null, sofiaEnabled: true,
        status: 'ACTIVE', humanStatus: 'SOFIA_ACTIVE', phone: '573001234567',
      }),
      findSystemActorId: jest.fn().mockResolvedValue('system-actor'),
      findOutboundByIdempotency: jest.fn(),
      createOutbound: jest.fn(),
    };
    const handoff = {
      decision: jest.fn().mockResolvedValue({ state: 'SOFIA_ACTIVE' }),
      transition: jest.fn().mockResolvedValue({ state: 'HUMAN_REQUIRED' }),
    };
    let workerARenewals = 0;
    const inboundGateway = {
      checkpoint: jest.fn().mockImplementation(async (claimContext, checkpointValue) => {
        if (claimContext.claimToken === 'worker-a') startedCheckpoint = checkpointValue;
      }),
      renew: jest.fn().mockImplementation(async (claimContext) => {
        if (claimContext.claimToken !== 'worker-a') return new Date(Date.now() + 120_000);
        workerARenewals += 1;
        if (workerARenewals === 1) return new Date(Date.now() + 120_000);
        throw new Error('WHATSAPP_INBOUND_LEASE_LOST');
      }),
    };
    const agent = {
      processInboundMessage: jest.fn().mockImplementation(async () => {
        effects.draft += 1;
        effects.audit += 1;
        return agentResult;
      }),
    };
    const service = new SofiaWhatsappService(
      conversations as never,
      { isAutoReplyAllowed: jest.fn().mockReturnValue(false) } as never,
      agent as never,
      { evaluate: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      {} as never,
      inboundGateway as never,
      { identityHash: jest.fn().mockReturnValue('recipient-hash') } as never,
      { inbound: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      handoff as never,
      {} as never,
    );
    const privateService = service as unknown as {
      handleInboundMode(input: Record<string, unknown>): Promise<unknown>;
    };
    const baseInput = {
      mode: 'receive_only', providerName: 'qr_gateway', parsed,
      conversationId: 'conversation-1', inboundMessageId: 'inbound-message-1',
      accountId: 'account-1', headers: {}, eventHash: 'event-hash-1',
    };
    const workerAClaim = Object.freeze({
      ...claim(null), claimToken: 'worker-a', leaseExpiresAt: new Date(Date.now() + 1_000),
    });

    try {
      const workerA = privateService.handleInboundMode({ ...baseInput, claim: workerAClaim });
      for (let index = 0; index < 20 && agent.processInboundMessage.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(agent.processInboundMessage).toHaveBeenCalledTimes(1);
      expect(startedCheckpoint).toMatchObject({ kind: 'SOFIA_CONVERSATION_STARTED_V1' });

      await jest.advanceTimersByTimeAsync(30_000);
      const workerBClaim = Object.freeze({
        ...claim(startedCheckpoint), claimToken: 'worker-b', attempt: 2,
      });
      await expect(privateService.handleInboundMode({ ...baseInput, claim: workerBClaim })).resolves.toMatchObject({
        processingStatus: 'HUMAN_REQUIRED',
        outbound: null,
        errorMessage: 'WHATSAPP_INBOUND_PROCESSING_OUTCOME_UNKNOWN',
      });

      resolveAgent({
        responseText: 'Resultado del worker obsoleto.', confidence: 0.95,
        shouldHandoff: false, mediaSuggestion: null, businessStatus: { isOpen: true },
      });
      await expect(workerA).rejects.toThrow('WHATSAPP_INBOUND_LEASE_LOST');

      expect(agent.processInboundMessage).toHaveBeenCalledTimes(1);
      expect(effects).toEqual({ draft: 1, audit: 1 });
      expect(handoff.transition).toHaveBeenCalledTimes(1);
      expect(conversations.createOutbound).not.toHaveBeenCalled();
      expect(inboundGateway.renew).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
