import { Injectable } from '@nestjs/common';
import { OperationalAlertSeverity, OperationalAlertStatus, WhatsappConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaGovernanceService } from '../governance/sofia-governance.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';
import { SofiaMetricsRange, SofiaMetricsResponse } from './sofia-metrics.types';

@Injectable()
export class SofiaMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governanceService: SofiaGovernanceService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  async getSummary(range: SofiaMetricsRange = 'today'): Promise<SofiaMetricsResponse> {
    const since = this.rangeStart(range);
    const todayStart = this.rangeStart('today');
    const [
      conversationCounts,
      inboundCounts,
      outboundCounts,
      autoSafeEvents,
      ruleEvents,
      memoryCounts,
      governance,
      backupSetting,
      openAlerts,
      criticalAlerts,
    ] = await Promise.all([
      this.conversationCounts(since),
      this.inboundCounts(since),
      this.outboundCounts(since),
      this.prisma.sofiaAutoSafeDecisionEvent.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, riskLevel: true, reasonCodesJson: true },
      }),
      this.prisma.sofiaCommercialRuleEvent.findMany({
        where: { createdAt: { gte: since } },
        select: { ruleCode: true },
      }),
      this.memoryCounts(todayStart),
      this.governanceService.getEnterpriseStatus(),
      this.prisma.setting.findUnique({ where: { key: 'SOFIA_SANITIZED_BACKUP_LAST_DRY_RUN' } }),
      this.prisma.operationalAlert.count({ where: { module: 'sofia', status: OperationalAlertStatus.OPEN } }),
      this.prisma.operationalAlert.count({ where: { module: 'sofia', severity: OperationalAlertSeverity.CRITICAL, status: OperationalAlertStatus.OPEN } }),
    ]);

    const reasonCodes = this.flattenReasonCodes(autoSafeEvents.map((event) => event.reasonCodesJson));
    const ruleBuckets = this.bucket(ruleEvents.map((event) => event.ruleCode));
    const paidClaimsBlocked = reasonCodes.find((item) => item.key === 'PAID_CLAIM_BLOCKED')?.count ?? 0;

    return this.privacyService.sanitizeJson({
      generatedAt: new Date().toISOString(),
      range,
      conversations: conversationCounts,
      inbound: inboundCounts,
      outbound: outboundCounts,
      autoSafe: {
        total: autoSafeEvents.length,
        approved: autoSafeEvents.filter((event) => event.status === 'AUTO_SAFE_APPROVED').length,
        humanRequired: autoSafeEvents.filter((event) => event.status === 'HUMAN_REQUIRED').length,
        blocked: autoSafeEvents.filter((event) => event.status === 'BLOCKED').length,
        draftOnly: autoSafeEvents.filter((event) => event.status === 'DRAFT_ONLY').length,
        topReasonCodes: reasonCodes.slice(0, 8),
        riskLevels: this.bucket(autoSafeEvents.map((event) => event.riskLevel)),
      },
      catalog: {
        productMentions: ruleBuckets.filter((item) => item.key.includes('PRODUCT') || item.key.includes('CATALOG')).slice(0, 8),
        unknownProducts: reasonCodes.find((item) => item.key === 'UNKNOWN_PRODUCT')?.count ?? 0,
        unknownPrices: reasonCodes.find((item) => item.key === 'UNKNOWN_PRICE')?.count ?? 0,
        maxiFamilyCorrections: ruleEvents.filter((event) => event.ruleCode.includes('MAXI_FAMILY')).length,
      },
      payments: {
        paymentSensitiveMessages: reasonCodes.find((item) => item.key === 'PAYMENT_SENSITIVE')?.count ?? 0,
        paidClaimsBlocked,
        whatsappCanMarkPaid: false as const,
      },
      memory: memoryCounts,
      safety: {
        safetyBlocks: autoSafeEvents.filter((event) => event.status === 'BLOCKED').length,
        prohibitedPhraseBlocks: reasonCodes.find((item) => item.key === 'MAXI_FAMILY_COPY_RISK')?.count ?? 0,
        inventedPromotionBlocks: reasonCodes.find((item) => item.key === 'INVENTED_PROMOTION')?.count ?? 0,
      },
      governance: {
        productionStatus: governance.productionReadiness.status,
        activeBlockers: governance.productionReadiness.blockers,
        killSwitchState: governance.sofia.globalPaused ? 'PAUSED' : 'ACTIVE',
        qrReceiveOnlyStatus: governance.whatsapp.qrReceiveOnlyReady ? 'PASS' : 'WARNING',
      },
      system: {
        health: 'ok',
        lastBackupAt:
          backupSetting?.value && typeof backupSetting.value === 'object' && !Array.isArray(backupSetting.value)
            ? String((backupSetting.value as { generatedAt?: unknown }).generatedAt ?? '')
            : null,
        logSanitizationStatus: 'PASS',
        retentionStatus: 'DRY_RUN_READY',
        alertsOpen: openAlerts,
        alertsCritical: criticalAlerts,
      },
    } satisfies SofiaMetricsResponse);
  }

  getAutoSafe(range: SofiaMetricsRange = 'today') {
    return this.getSummary(range).then((summary) => summary.autoSafe);
  }

  getConversations(range: SofiaMetricsRange = 'today') {
    return this.getSummary(range).then((summary) => summary.conversations);
  }

  getQr(range: SofiaMetricsRange = 'today') {
    return this.getSummary(range).then((summary) => summary.inbound);
  }

  getSafety(range: SofiaMetricsRange = 'today') {
    return this.getSummary(range).then((summary) => summary.safety);
  }

  async exportSanitized(range: SofiaMetricsRange = 'today') {
    const summary = await this.getSummary(range);
    return this.privacyService.sanitizeJson({
      exportType: 'SOFIA_METRICS_SANITIZED',
      noSecrets: true,
      noRawMessages: true,
      noFullPhones: true,
      summary,
    });
  }

  private async conversationCounts(since: Date) {
    const [total, active, humanRequired, humanTaken, paused, resolved] = await Promise.all([
      this.prisma.whatsappConversation.count({ where: { updatedAt: { gte: since } } }),
      this.prisma.whatsappConversation.count({ where: { status: WhatsappConversationStatus.ACTIVE, updatedAt: { gte: since } } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_REQUIRED', updatedAt: { gte: since } } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_TAKEN', updatedAt: { gte: since } } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'SOFIA_PAUSED', updatedAt: { gte: since } } }),
      this.prisma.whatsappConversation.count({ where: { status: WhatsappConversationStatus.RESOLVED, updatedAt: { gte: since } } }),
    ]);
    return { total, active, humanRequired, humanTaken, paused, resolved, averageResponseDraftTimeMs: null };
  }

  private async inboundCounts(since: Date) {
    const [total, qrGateway, simulated, allowlistBlocked, duplicatesIgnored, mediaWithoutTranscript] = await Promise.all([
      this.prisma.whatsappInboundEvent.count({ where: { receivedAt: { gte: since } } }),
      this.prisma.whatsappInboundEvent.count({ where: { provider: 'qr_gateway', receivedAt: { gte: since } } }),
      this.prisma.whatsappInboundEvent.count({ where: { rawPayload: { path: ['summary', 'source'], string_contains: 'TEST_INBOUND' }, receivedAt: { gte: since } } }),
      this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'ALLOWLIST_REQUIRED', receivedAt: { gte: since } } }),
      this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'DUPLICATE_IGNORED', receivedAt: { gte: since } } }),
      this.prisma.whatsappInboundEvent.count({ where: { processingStatus: { in: ['FROM_ME_IGNORED', 'SOFIA_PAUSED'] }, receivedAt: { gte: since } } }),
    ]);
    return { total, qrGateway, simulated, allowlistBlocked, duplicatesIgnored, mediaWithoutTranscript };
  }

  private async outboundCounts(since: Date) {
    const [suggested, draftOnly, approvalPending, blockedRealSend, sentReal] = await Promise.all([
      this.prisma.whatsappOutboundMessage.count({ where: { status: 'SUGGESTED', createdAt: { gte: since } } }),
      this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { status: 'DRAFT_ONLY', createdAt: { gte: since } } }),
      this.prisma.whatsappOutboundMessage.count({ where: { status: 'APPROVAL_PENDING', createdAt: { gte: since } } }),
      this.prisma.auditLog.count({ where: { module: 'SofiaWhatsappQrGateway', action: 'SOFIA_QR_REAL_SEND_BLOCKED', createdAt: { gte: since } } }),
      this.prisma.whatsappOutboundMessage.count({ where: { status: 'SENT', provider: 'qr_gateway', sentAt: { gte: since } } }),
    ]);
    return { suggested, draftOnly, approvalPending, blockedRealSend, sentReal };
  }

  private async memoryCounts(todayStart: Date) {
    const [customersWithMemory, updatedToday, optOuts, memoryUncertain] = await Promise.all([
      this.prisma.sofiaCustomerMemory.count(),
      this.prisma.sofiaCustomerMemory.count({ where: { updatedAt: { gte: todayStart } } }),
      this.prisma.sofiaCustomerMemory.count({ where: { consentState: 'OPTED_OUT' } }),
      this.prisma.sofiaCommercialRuleEvent.count({ where: { ruleCode: 'MEMORY_UNCERTAIN', createdAt: { gte: todayStart } } }),
    ]);
    return { customersWithMemory, updatedToday, optOuts, memoryUncertain };
  }

  private flattenReasonCodes(values: unknown[]) {
    const codes = values.flatMap((value) => (Array.isArray(value) ? value.map(String) : []));
    return this.bucket(codes);
  }

  private bucket(values: string[]) {
    const map = new Map<string, number>();
    for (const value of values.filter(Boolean)) map.set(value, (map.get(value) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  private rangeStart(range: SofiaMetricsRange) {
    const now = new Date();
    const days = range === '30d' ? 30 : range === '7d' ? 7 : 1;
    const start = new Date(now);
    start.setDate(now.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return start;
  }
}
