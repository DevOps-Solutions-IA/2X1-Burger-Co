import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';

@Injectable()
export class SofiaLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  async insights() {
    const [feedback, autoSafe, ruleEvents, inbound] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { module: 'SofiaLearningFeedback', action: 'SOFIA_HUMAN_FEEDBACK_CREATED' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { newValues: true, createdAt: true },
      }),
      this.prisma.sofiaAutoSafeDecisionEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { reasonCodesJson: true, status: true },
      }),
      this.prisma.sofiaCommercialRuleEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { ruleCode: true },
      }),
      this.prisma.whatsappInboundEvent.findMany({
        where: { provider: 'qr_gateway' },
        orderBy: { receivedAt: 'desc' },
        take: 200,
        select: { processingStatus: true },
      }),
    ]);
    const reasonCodes = autoSafe.flatMap((event) => (Array.isArray(event.reasonCodesJson) ? event.reasonCodesJson.map(String) : []));
    const feedbackTypes = feedback
      .map((row) => (row.newValues && typeof row.newValues === 'object' && !Array.isArray(row.newValues) ? String((row.newValues as { feedbackType?: unknown }).feedbackType ?? '') : ''))
      .filter(Boolean);
    const buckets = (values: string[]) => {
      const map = new Map<string, number>();
      for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
      return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    };
    const recommendations = [
      ...buckets(reasonCodes).filter((item) => ['UNKNOWN_PRODUCT', 'UNKNOWN_PRICE', 'PAYMENT_SENSITIVE', 'LOW_CONFIDENCE'].includes(item.key)).map((item) => ({
        type: item.key,
        count: item.count,
        recommendation:
          item.key === 'UNKNOWN_PRODUCT'
            ? 'Revisar si hay gap de catálogo. No agregar producto sin decisión comercial.'
            : item.key === 'UNKNOWN_PRICE'
              ? 'Vincular productos del catálogo a precios reales antes de responder valores.'
              : item.key === 'PAYMENT_SENSITIVE'
                ? 'Mantener revisión humana para pagos manuales y reclamos de pago.'
                : 'Revisar prompt/catálogo/memoria para reducir handoff por baja confianza.',
      })),
      ...buckets(ruleEvents.map((event) => event.ruleCode)).filter((item) => item.key.includes('MAXI') || item.key.includes('CATALOG')).slice(0, 5).map((item) => ({
        type: item.key,
        count: item.count,
        recommendation: 'Revisar regla comercial. Los cambios requieren aprobación humana.',
      })),
      ...buckets(inbound.map((event) => event.processingStatus)).filter((item) => ['ALLOWLIST_REQUIRED', 'DUPLICATE_IGNORED'].includes(item.key)).map((item) => ({
        type: item.key,
        count: item.count,
        recommendation: item.key === 'ALLOWLIST_REQUIRED' ? 'Revisar allowlist de piloto antes de pruebas físicas.' : 'Deduplicación activa; monitorear reintentos del canal.',
      })),
    ];
    return this.privacyService.sanitizeJson({
      generatedAt: new Date().toISOString(),
      feedbackCount: feedback.length,
      topFeedbackTypes: buckets(feedbackTypes).slice(0, 8),
      topReasonCodes: buckets(reasonCodes).slice(0, 8),
      recommendations,
      noExternalTraining: true,
      noAutomaticPromptChanges: true,
      noAutomaticCatalogChanges: true,
    });
  }
}
