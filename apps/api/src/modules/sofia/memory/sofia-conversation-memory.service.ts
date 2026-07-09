import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SofiaConversationMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(input: { conversationId: string; customerMemoryId?: string | null }) {
    return this.prisma.sofiaConversationMemory.upsert({
      where: { conversationId: input.conversationId },
      create: {
        conversationId: input.conversationId,
        customerMemoryId: input.customerMemoryId ?? null,
      },
      update: {
        customerMemoryId: input.customerMemoryId ?? undefined,
      },
    });
  }

  async updateContext(input: {
    conversationId: string;
    customerMemoryId?: string | null;
    currentIntent?: string | null;
    currentOrderIntent?: Prisma.InputJsonValue;
    missingFields?: string[];
    lastProductDiscussed?: string | null;
    memorySummary?: string | null;
  }) {
    await this.getOrCreate({ conversationId: input.conversationId, customerMemoryId: input.customerMemoryId });
    return this.prisma.sofiaConversationMemory.update({
      where: { conversationId: input.conversationId },
      data: {
        customerMemoryId: input.customerMemoryId ?? undefined,
        currentIntent: input.currentIntent ?? undefined,
        currentOrderIntentJson: input.currentOrderIntent ?? undefined,
        missingFieldsJson: input.missingFields ?? undefined,
        lastProductDiscussed: input.lastProductDiscussed ?? undefined,
        memorySummary: input.memorySummary ?? undefined,
      },
    });
  }

  sanitize(memory: {
    id: string;
    conversationId: string;
    currentIntent: string | null;
    currentOrderIntentJson: Prisma.JsonValue | null;
    missingFieldsJson: Prisma.JsonValue | null;
    lastProductDiscussed: string | null;
    memorySummary: string | null;
    updatedAt: Date;
  }) {
    return {
      id: memory.id,
      conversationId: memory.conversationId,
      currentIntent: memory.currentIntent,
      currentOrderIntent: memory.currentOrderIntentJson,
      missingFields: memory.missingFieldsJson,
      lastProductDiscussed: memory.lastProductDiscussed,
      memorySummary: memory.memorySummary,
      updatedAt: memory.updatedAt.toISOString(),
    };
  }
}
