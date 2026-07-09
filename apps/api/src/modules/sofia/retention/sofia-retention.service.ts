import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SOFIA_RETENTION_POLICY } from './sofia-retention-policy';

@Injectable()
export class SofiaRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  status() {
    return {
      status: 'DRY_RUN_READY',
      policy: SOFIA_RETENTION_POLICY,
      destructiveRunDefault: false,
      protectedDomains: SOFIA_RETENTION_POLICY.protectedDomains,
    };
  }

  async dryRun() {
    const now = new Date();
    const olderThan = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [qrInboundRawSummaries, autoSafeDecisionEvents, commercialRuleEvents, humanFeedback, conversationMemoryExpired] = await Promise.all([
      this.prisma.whatsappInboundEvent.count({
        where: { provider: 'qr_gateway', receivedAt: { lt: olderThan(SOFIA_RETENTION_POLICY.qrInboundRawSummariesDays) } },
      }),
      this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { createdAt: { lt: olderThan(SOFIA_RETENTION_POLICY.autoSafeDecisionEventsDays) } } }),
      this.prisma.sofiaCommercialRuleEvent.count({ where: { createdAt: { lt: olderThan(SOFIA_RETENTION_POLICY.commercialRuleEventsDays) } } }),
      this.prisma.auditLog.count({
        where: {
          module: 'SofiaLearningFeedback',
          action: 'SOFIA_HUMAN_FEEDBACK_CREATED',
          createdAt: { lt: olderThan(SOFIA_RETENTION_POLICY.humanFeedbackDays) },
        },
      }),
      this.prisma.sofiaConversationMemory.count({ where: { expiresAt: { lt: now } } }),
    ]);
    return {
      dryRun: true,
      willDeleteOperationalOrders: false,
      willDeletePayments: false,
      willDeleteCashOrStock: false,
      candidates: {
        qrInboundRawSummaries,
        autoSafeDecisionEvents,
        commercialRuleEvents,
        humanFeedback,
        conversationMemoryExpired,
      },
      policy: SOFIA_RETENTION_POLICY,
    };
  }

  async run(input: { confirm?: boolean }, actorId: string) {
    if (input.confirm !== true) {
      throw new BadRequestException('Retention real bloqueada: requiere confirm=true y revisión admin. Use dry-run primero.');
    }
    const dryRun = await this.dryRun();
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'SOFIA_RETENTION_RUN_BLOCKED_FOR_F6',
        module: 'SofiaRetention',
        entity: 'sofia_retention',
        newValues: { dryRun, blockedInF6: true },
      },
    });
    throw new BadRequestException('Retention real permanece bloqueada en F6. No se borraron datos.');
  }
}
