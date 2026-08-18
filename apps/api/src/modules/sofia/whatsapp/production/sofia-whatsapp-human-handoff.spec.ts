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
  timestamp: new Date('2026-08-17T10:00:00.000Z'),
  rawPayload: {},
};

function claim(): WhatsappInboundClaimContext {
  return Object.freeze({
    inboundEventId: 'inbound-event-1',
    claimToken: 'lease-token',
    attempt: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    recoveryCheckpoint: null,
  });
}

function buildService(conversation: Record<string, unknown>) {
  const agent = { processInboundMessage: jest.fn() };
  const conversations = {
    findConversation: jest.fn().mockResolvedValue(conversation),
    findSystemActorId: jest.fn().mockResolvedValue('system-actor'),
    findOutboundByIdempotency: jest.fn().mockResolvedValue(null),
    createOutbound: jest.fn(),
  };
  const inboundGateway = {
    checkpoint: jest.fn(),
    renew: jest.fn().mockResolvedValue(new Date(Date.now() + 120_000)),
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
    { decision: jest.fn(), transition: jest.fn() } as never,
    {} as never,
  );
  const privateService = service as unknown as {
    handleInboundMode(input: Record<string, unknown>): Promise<{ processingStatus: string; outbound: unknown; sofiaResult: unknown }>;
  };
  const baseInput = {
    mode: 'receive_only',
    providerName: 'qr_gateway',
    parsed,
    conversationId: 'conversation-1',
    inboundMessageId: 'inbound-message-1',
    accountId: 'account-1',
    headers: {},
    eventHash: 'event-hash-1',
    claim: claim(),
  };
  return { privateService, baseInput, agent, conversations };
}

describe('Sofia WhatsApp inbound respects human handoff before invoking AI', () => {
  it('never calls the AI agent when a human has taken the conversation', async () => {
    const { privateService, baseInput, agent } = buildService({
      id: 'conversation-1',
      customerId: null,
      sofiaEnabled: true,
      status: 'ACTIVE',
      humanStatus: 'HUMAN_TAKEN',
      phone: '573001234567',
    });

    const result = await privateService.handleInboundMode(baseInput);

    expect(agent.processInboundMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ processingStatus: 'SOFIA_PAUSED', outbound: null, sofiaResult: null, errorMessage: null });
  });

  it('never calls the AI agent when Sofia is disabled for the conversation', async () => {
    const { privateService, baseInput, agent } = buildService({
      id: 'conversation-1',
      customerId: null,
      sofiaEnabled: false,
      status: 'ACTIVE',
      humanStatus: 'SOFIA_ACTIVE',
      phone: '573001234567',
    });

    const result = await privateService.handleInboundMode(baseInput);

    expect(agent.processInboundMessage).not.toHaveBeenCalled();
    expect(result.processingStatus).toBe('SOFIA_PAUSED');
  });

  it('never calls the AI agent while the conversation is paused', async () => {
    const { privateService, baseInput, agent } = buildService({
      id: 'conversation-1',
      customerId: null,
      sofiaEnabled: true,
      status: 'SOFIA_PAUSED',
      humanStatus: 'SOFIA_ACTIVE',
      phone: '573001234567',
    });

    const result = await privateService.handleInboundMode(baseInput);

    expect(agent.processInboundMessage).not.toHaveBeenCalled();
    expect(result.processingStatus).toBe('SOFIA_PAUSED');
  });

  it('calls the AI agent once the conversation is active and Sofia-enabled', async () => {
    const { privateService, baseInput, agent, conversations } = buildService({
      id: 'conversation-1',
      customerId: null,
      sofiaEnabled: true,
      status: 'ACTIVE',
      humanStatus: 'SOFIA_ACTIVE',
      phone: '573001234567',
    });
    agent.processInboundMessage.mockResolvedValue({
      responseText: 'Claro, te ayudo con tu pedido.',
      confidence: 0.9,
      shouldHandoff: false,
      mediaSuggestion: null,
      businessStatus: { isOpen: true },
      autoSafeDecision: { status: 'AUTO_SAFE_APPROVED', eventId: 'decision-1' },
    });
    conversations.createOutbound.mockResolvedValue({ id: 'outbound-1', status: 'SUGGESTED' });

    await privateService.handleInboundMode(baseInput);

    expect(agent.processInboundMessage).toHaveBeenCalledTimes(1);
    expect(conversations.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ autoSafeDecisionEventId: 'decision-1' }),
    );
  });
});
