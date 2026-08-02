import { Injectable } from '@nestjs/common';
import { Prisma, SofiaOrderDraftStatus, WhatsappConversationStatus, WhatsappMessageDirection, WhatsappMessageType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SofiaAgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  linkCustomerMemory(memoryId: string, customerId: string) {
    return this.prisma.sofiaCustomerMemory.update({ where: { id: memoryId }, data: { customerId } });
  }

  createMessage(input: { conversationId: string; direction: WhatsappMessageDirection; type: WhatsappMessageType; body?: string | null; transcript?: string | null; aiIntent?: string; confidence?: number; rawPayload?: Prisma.InputJsonValue }) {
    return this.prisma.whatsappMessage.create({ data: input });
  }

  findActiveDraft(conversationId: string) {
    return this.prisma.sofiaOrderDraft.findFirst({
      where: { conversationId, status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] } },
      orderBy: { updatedAt: 'desc' },
      include: { deliveryOrder: true, conversation: true },
    });
  }

  findDraftForRecovery(input: { draftId?: string; conversationId?: string }) {
    return input.draftId
      ? this.prisma.sofiaOrderDraft.findUnique({ where: { id: input.draftId }, include: { conversation: true, deliveryOrder: true } })
      : this.prisma.sofiaOrderDraft.findFirst({
          where: {
            conversationId: input.conversationId,
            status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] },
            deliveryOrder: null,
          },
          orderBy: { updatedAt: 'desc' },
          include: { conversation: true, deliveryOrder: true },
        });
  }

  requireHuman(conversationId: string) {
    return this.prisma.whatsappConversation.update({ where: { id: conversationId }, data: { status: WhatsappConversationStatus.HUMAN_REQUIRED, sofiaEnabled: false } });
  }

  touchConversation(conversationId: string) {
    return this.prisma.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  }
}
