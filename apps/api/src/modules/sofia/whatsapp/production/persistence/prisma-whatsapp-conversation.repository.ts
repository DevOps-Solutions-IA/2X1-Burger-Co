import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SofiaOrderSource,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';

@Injectable()
export class PrismaWhatsappConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createInboundMessage(input: {
    conversationId: string;
    type: WhatsappMessageType;
    provider: string;
    providerMessageId: string | null;
    providerTimestamp: Date | null;
    body: string | null;
    mediaMimeType: string | null;
    transcript: string | null;
    payloadHash: string;
    status: string;
    idempotencyKey: string;
    errorMessage?: string | null;
  }) {
    try {
      return await this.prisma.whatsappMessage.create({
        data: {
          conversationId: input.conversationId,
          direction: WhatsappMessageDirection.INBOUND,
          type: input.type,
          provider: input.provider,
          providerMessageId: input.providerMessageId,
          providerTimestamp: input.providerTimestamp,
          body: input.body,
          mediaUrl: null,
          mediaMimeType: input.mediaMimeType,
          transcript: input.transcript,
          rawPayload: { normalized: true, payloadHash: input.payloadHash },
          status: input.status,
          idempotencyKey: input.idempotencyKey,
          errorMessage: input.errorMessage,
        },
      });
    } catch (error) {
      if (!this.unique(error)) throw error;
      return this.prisma.whatsappMessage.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
    }
  }

  flagConversation(conversationId: string, riskFlags: Record<string, unknown>) {
    return this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { riskFlags: riskFlags as Prisma.InputJsonValue },
    });
  }

  async cancelOutbound(outboundId: string, actorId: string) {
    const outbound = await this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outboundId } });
    if (!outbound) return null;
    return this.prisma.whatsappOutboundMessage.update({
      where: { id: outboundId },
      data: { status: 'CANCELLED', approvedById: actorId, approvedAt: new Date() },
    });
  }

  findOutboundByIdempotency(idempotencyKey: string) {
    return this.prisma.whatsappOutboundMessage.findUnique({ where: { idempotencyKey } });
  }

  createOutbound(input: {
    conversationId: string;
    inboundMessageId: string;
    provider: string;
    localMessageId: string;
    body: string;
    mediaUrl: string | null;
    status: string;
    idempotencyKey: string;
    accountId: string;
    recipientIdentityHash: string;
  }) {
    return this.prisma.whatsappOutboundMessage.create({ data: { ...input, purpose: 'SERVICE' } });
  }

  findActiveConversation(phone: string, source: SofiaOrderSource) {
    return this.prisma.whatsappConversation.findFirst({
      where: { phone, source, status: { not: WhatsappConversationStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  updateConversation(
    id: string,
    input: {
      customerName: string | null;
      provider: string;
      providerConversationId: string | null;
      mode: string;
      lastMessagePreview: string;
      customerId?: string;
    },
  ) {
    return this.prisma.whatsappConversation.update({
      where: { id },
      data: {
        ...input,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        unreadCount: { increment: 1 },
      },
    });
  }

  createConversation(input: {
    phone: string;
    customerName: string | null;
    provider: string;
    providerConversationId: string | null;
    mode: string;
    source: SofiaOrderSource;
    customerId: string | null;
    lastMessagePreview: string;
  }) {
    return this.prisma.whatsappConversation.create({
      data: {
        ...input,
        status: WhatsappConversationStatus.ACTIVE,
        humanStatus: 'SOFIA_ACTIVE',
        sofiaEnabled: true,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        unreadCount: 1,
      },
    });
  }

  findConversation(conversationId: string) {
    return this.prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  }

  loadConversation(conversationId: string) {
    return this.prisma.whatsappConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        outboundMessages: { orderBy: { createdAt: 'asc' } },
        orderDrafts: { orderBy: { createdAt: 'desc' }, take: 10 },
        deliveryOrders: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async findSystemActorId() {
    const user = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        roles: { some: { role: { name: { in: ['admin', 'supervisor', 'cashier'] } } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private unique(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
  }
}
