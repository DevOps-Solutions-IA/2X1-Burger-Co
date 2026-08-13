import {
  SofiaOrderSource,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
} from '@prisma/client';
import { SofiaService } from './sofia.service';

const timestamp = (index: number) => new Date(Date.UTC(2026, 7, 13, 12, index));

function conversation(id: string) {
  return {
    id,
    phone: '+573001234567',
    customerName: 'Cliente de prueba',
    source: SofiaOrderSource.WHATSAPP,
    status: WhatsappConversationStatus.ACTIVE,
    provider: 'qr_gateway',
    mode: 'receive_only',
    sofiaEnabled: true,
    humanStatus: 'SOFIA_ACTIVE',
    lastMessagePreview: 'Mensaje reciente',
    lastMessageAt: timestamp(29),
    lastInboundAt: timestamp(29),
    unreadCount: 0,
    riskFlags: null,
    createdAt: timestamp(0),
    updatedAt: timestamp(29),
    messages: [],
    outboundMessages: [],
    _count: { deliveryOrders: 0, orderDrafts: 0, outboundMessages: 0 },
  };
}

function subject() {
  const prisma = {
    whatsappConversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    whatsappOutboundMessage: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new SofiaService(
    prisma as never,
    {} as never,
    config as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('SofiaService bounded conversation inbox', () => {
  it('returns a bounded list while reporting complete aggregate counts beyond 100 conversations', async () => {
    const { service, prisma } = subject();
    const allConversations = Array.from({ length: 125 }, (_, index) => conversation(`conversation-${index + 1}`));
    prisma.whatsappConversation.findMany.mockImplementation(({ take }: { take: number }) =>
      Promise.resolve(allConversations.slice(0, take)),
    );
    prisma.whatsappConversation.count
      .mockResolvedValueOnce(125)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(8);
    prisma.whatsappOutboundMessage.count
      .mockResolvedValueOnce(107)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.whatsappOutboundMessage.groupBy.mockResolvedValue([
      { conversationId: 'conversation-1', _count: { _all: 9 } },
    ]);

    const inbox = await service.getConversationsInbox();

    expect(prisma.whatsappConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
    expect(inbox.internalValidation.conversations).toHaveLength(100);
    expect(inbox.internalValidation.total).toBe(125);
    expect(inbox.summary).toMatchObject({
      totalConversations: 130,
      internalValidationConversations: 125,
      sandboxConversations: 3,
      historicalConversations: 2,
      pendingReview: 8,
      internalValidationOutboundSent: 107,
      sandboxOutboundSent: 2,
      historicalOutboundSent: 1,
    });
    expect(inbox.filters).toMatchObject({
      allOperational: 125,
      humanRequired: 7,
      paymentSensitive: 5,
      unknownProduct: 4,
      blocked: 3,
      aiSuggestions: 6,
    });
    expect(inbox.internalValidation.conversations[0]).toMatchObject({
      outboxTotal: 0,
      outboundSentCount: 9,
      safety: { realSendingEnabled: false, whatsappCanMarkPaid: false },
    });
  });

  it('selects the newest 24 inbound and outbound events and presents them chronologically', async () => {
    const { service, prisma } = subject();
    const allMessages = Array.from({ length: 30 }, (_, index) => ({
      id: `message-${index}`,
      direction: WhatsappMessageDirection.INBOUND,
      provider: 'qr_gateway',
      body: `Mensaje ${index}`,
      transcript: null,
      status: 'PROCESSED',
      errorMessage: null,
      aiIntent: null,
      confidence: null,
      createdAt: timestamp(index),
    }));
    const allOutbound = Array.from({ length: 30 }, (_, index) => ({
      id: `outbound-${index}`,
      body: `Borrador ${index}`,
      mediaUrl: null,
      status: 'DRAFT_ONLY',
      attempts: 0,
      lastError: null,
      createdAt: timestamp(index),
      sentAt: null,
    }));
    const base = conversation('conversation-detail');
    prisma.whatsappConversation.findUnique.mockImplementation(
      ({ select }: { select: { messages: { take: number }; outboundMessages: { take: number } } }) =>
        Promise.resolve({
          ...base,
          messages: [...allMessages].reverse().slice(0, select.messages.take),
          outboundMessages: [...allOutbound].reverse().slice(0, select.outboundMessages.take),
          _count: { deliveryOrders: 0, orderDrafts: 0, outboundMessages: allOutbound.length },
        }),
    );
    prisma.whatsappOutboundMessage.count.mockResolvedValue(15);

    const detail = await service.getConversationInbox(base.id);

    const select = prisma.whatsappConversation.findUnique.mock.calls[0]![0].select;
    expect(select.messages).toMatchObject({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 24 });
    expect(select.outboundMessages).toMatchObject({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 24 });
    expect(detail.messages.map(({ id }) => id)).toEqual(
      Array.from({ length: 24 }, (_, offset) => `message-${offset + 6}`),
    );
    expect(detail.outboundMessages.map(({ id }) => id)).toEqual(
      Array.from({ length: 24 }, (_, offset) => `outbound-${offset + 6}`),
    );
    expect(detail.messages.some(({ id }) => id === 'message-5')).toBe(false);
    expect(detail.outboundMessages.some(({ id }) => id === 'outbound-5')).toBe(false);
    expect(detail).toMatchObject({
      outboxTotal: 30,
      outboundSentCount: 15,
      safety: { realSendingEnabled: false, whatsappCanMarkPaid: false },
    });
  });
});
