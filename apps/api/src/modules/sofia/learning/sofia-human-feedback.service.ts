import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';

export type SofiaHumanFeedbackInput = {
  conversationId?: string | null;
  messageId?: string | null;
  autoSafeDecisionEventId?: string | null;
  customerMemoryId?: string | null;
  feedbackType: string;
  rating?: number | null;
  correctedReply?: string | null;
  notes?: string | null;
  tags?: string[];
};

@Injectable()
export class SofiaHumanFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  async createFeedback(input: SofiaHumanFeedbackInput, actorId: string) {
    const payload = this.privacyService.sanitizeJson({
      feedbackType: input.feedbackType,
      rating: input.rating ?? null,
      correctedReply: input.correctedReply ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      autoSafeDecisionEventId: input.autoSafeDecisionEventId ?? null,
      customerMemoryId: input.customerMemoryId ?? null,
      noExternalTraining: true,
      noPromptAutoChange: true,
    });
    return this.auditService.log({
      userId: actorId,
      action: 'SOFIA_HUMAN_FEEDBACK_CREATED',
      module: 'SofiaLearningFeedback',
      entity: 'sofia_human_feedback',
      entityId: input.conversationId ?? input.messageId ?? input.customerMemoryId ?? null,
      newValues: payload as Prisma.InputJsonValue,
    });
  }

  async listFeedback(limit = 50) {
    const rows = await this.prisma.auditLog.findMany({
      where: { module: 'SofiaLearningFeedback', action: 'SOFIA_HUMAN_FEEDBACK_CREATED' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, entityId: true, newValues: true, createdAt: true },
    });
    return rows.map((row) => this.privacyService.sanitizeJson(row));
  }
}
