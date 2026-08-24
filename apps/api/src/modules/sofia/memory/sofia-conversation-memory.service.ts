import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaCommercialRepository } from '../commercial/persistence/prisma-commercial.repository';

@Injectable()
export class SofiaConversationMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    // SOFIA Round 5 / A30 CLOSURE (A29 finding, HIGH) -- `updateContext()` used to run its own,
    // independent, UNLOCKED `prisma.sofiaConversationMemory.update()` against the exact same
    // `currentOrderIntentJson` column the canonical, row-locked `PrismaCommercialRepository.
    // saveState()` (A26) writes to, with zero awareness of the canonical CONFIRMED marker. Per
    // CLAUDE.md ("REUSE -> EXTEND -> CENTRALIZE before CREATE NEW AUTHORITY"), this reuses A26's
    // actual row-lock primitive (via `saveLegacyConversationContext()`) instead of inventing a
    // second, parallel protection mechanism -- see that method's docstring for the exact guarantee.
    private readonly commercialRepository: PrismaCommercialRepository,
  ) {}

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
    // A30: was `this.prisma.sofiaConversationMemory.update(...)` -- a bare, unlocked write. Now
    // routed through the SAME row-locked, CONFIRMED-marker-protected primitive `saveState()` (A26)
    // uses, so this writer can no longer clobber a canonical CONFIRMED commercial record.
    return this.commercialRepository.saveLegacyConversationContext(input);
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
