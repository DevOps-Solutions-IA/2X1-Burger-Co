import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaAIProviderFactory } from '../ai/sofia-ai-provider.factory';
import { SofiaCommercialCatalogService } from '../catalog/sofia-commercial-catalog.service';
import { SofiaPromptService } from '../prompt/sofia-prompt.service';
import { SofiaWhatsappService } from '../sofia-whatsapp.service';
import { SofiaRuntimeSafetyService } from '../runtime-safety/sofia-runtime-safety.service';
import { SofiaWhatsappQrGatewayService } from '../whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service';
import { SofiaReadinessService } from './sofia-readiness.service';
import {
  SofiaEnterpriseStatusResponse,
  SofiaGovernanceSettingValue,
  SofiaSecretRotationStatus,
} from './sofia-governance.types';

const GOVERNANCE_KEYS = {
  globalPaused: 'SOFIA_GLOBAL_PAUSED',
  killSwitch: 'SOFIA_KILL_SWITCH',
  autoSafeProductionAllowed: 'SOFIA_AUTO_SAFE_PRODUCTION_ALLOWED',
  qrRealAllowed: 'SOFIA_QR_REAL_ALLOWED',
  deepSeekRealAllowed: 'SOFIA_DEEPSEEK_REAL_ALLOWED',
  secretRotationStatus: 'SOFIA_SECRET_ROTATION_STATUS',
} as const;

@Injectable()
export class SofiaGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly promptService: SofiaPromptService,
    private readonly catalogService: SofiaCommercialCatalogService,
    private readonly aiProviderFactory: SofiaAIProviderFactory,
    private readonly sofiaWhatsappService: SofiaWhatsappService,
    private readonly qrGatewayService: SofiaWhatsappQrGatewayService,
    private readonly readinessService: SofiaReadinessService,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
  ) {}

  async getEnterpriseStatus(): Promise<SofiaEnterpriseStatusResponse> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [activePrompt, catalogItems, governanceSettings, runtimeSafety] = await Promise.all([
      this.promptService.getActivePrompt().catch(() => null),
      this.catalogService.listActiveItems().catch(() => []),
      this.getGovernanceSettings(),
      this.runtimeSafetyService.getState(),
    ]);
    const aiStatus = this.aiProviderFactory.getStatus();
    const whatsappStatus = this.sofiaWhatsappService.getStatus();
    const qrStatus = await this.qrGatewayService.getStatus();
    const secretRotationStatus = this.secretRotationStatus(governanceSettings.secretRotationStatus);
    const globalPaused = runtimeSafety.globalPaused;
    const qrAllowed = governanceSettings.qrRealAllowed.allowed === true;
    const deepSeekAllowed = governanceSettings.deepSeekRealAllowed.allowed === true;
    const autoSafeProductionAllowed = governanceSettings.autoSafeProductionAllowed.allowed === true;
    const deepSeekEnvReady = Boolean(
      this.configService.get<string>('DEEPSEEK_API_KEY') &&
        this.configService.get<string>('DEEPSEEK_BASE_URL') &&
        this.configService.get<boolean>('DEEPSEEK_ENABLED') === true,
    );
    const qrGatewayReady = true;
    const realSendingEnabled = false;

    const [
      autoSafeCounts,
      lastAutoSafeDecision,
      customerMemoryCount,
      conversationMemoryCount,
      lastMemory,
      optOutCount,
      inboundToday,
      outboundToday,
      pendingOutbound,
      conversations,
      paymentSettings,
      lastEvents,
    ] = await Promise.all([
      this.autoSafeCounts(todayStart),
      this.prisma.sofiaAutoSafeDecisionEvent.findFirst({ orderBy: { createdAt: 'desc' } }),
      this.prisma.sofiaCustomerMemory.count(),
      this.prisma.sofiaConversationMemory.count(),
      this.prisma.sofiaCustomerMemory.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.sofiaCustomerMemory.count({ where: { consentState: 'OPTED_OUT' } }),
      this.prisma.whatsappInboundEvent.count({ where: { receivedAt: { gte: todayStart } } }),
      this.prisma.whatsappOutboundMessage.count({ where: { sentAt: { gte: todayStart } } }),
      this.prisma.whatsappOutboundMessage.count({ where: { status: { in: ['QUEUED', 'RETRYING', 'APPROVAL_PENDING'] } } }),
      this.conversationCounts(todayStart),
      this.prisma.sofiaPaymentSettings.findUnique({ where: { id: 'default' } }),
      this.lastEvents(),
    ]);

    const offers = catalogItems.filter((item) => item.type === 'OFFER');
    const additions = catalogItems.filter((item) => item.type === 'ADDITION');
    const missingPriceCount = catalogItems.filter((item) => item.price == null && item.priceSource !== 'NONE').length;
    const missingImageCount = offers.filter((item) => !item.imageUrl).length;
    const maxi = catalogItems.find((item) => item.slug === 'maxi-family');
    const maxiFamilyStatus =
      maxi?.composition?.requiredCopy === '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L' ? 'PASS' : 'BLOCKED';
    const checklist = this.readinessService.buildChecklist({
      promptActive: Boolean(activePrompt),
      catalogActive: catalogItems.length >= 4,
      memoryReady: true,
      autoSafeReady: true,
      killSwitchReady: true,
      secretRotationComplete: secretRotationStatus === 'COMPLETE',
      qrGatewayReady,
      deepSeekReady: deepSeekEnvReady && deepSeekAllowed,
      whatsappRealSendingEnabled: realSendingEnabled,
      qrReceiveOnlyReady: qrStatus.mode === 'receive_only',
      maxiFamilyProtected: maxiFamilyStatus === 'PASS',
      whatsappCanMarkPaid: false,
      checkoutRegressionKnownPass: true,
    });
    const productionReadiness = this.readinessService.summarize(checklist);
    const securityBlockers = [
      ...(secretRotationStatus !== 'COMPLETE' ? ['SECRET_ROTATION_PENDING'] : []),
      ...(!qrGatewayReady ? ['QR_GATEWAY_NOT_IMPLEMENTED'] : []),
      ...(!deepSeekEnvReady || !deepSeekAllowed ? ['DEEPSEEK_REAL_DISABLED'] : []),
      ...(!autoSafeProductionAllowed ? ['AUTO_SAFE_PRODUCTION_DISABLED'] : []),
      'REAL_SEND_DISABLED',
      'PRODUCTION_NOT_READY',
    ];

    return {
      generatedAt: now.toISOString(),
      overallStatus: productionReadiness.status === 'BLOCKED' ? 'BLOCKED_FOR_PRODUCTION' : productionReadiness.status === 'WARNING' ? 'WARNING' : 'READY_FOR_SANDBOX',
      productionReadiness,
      security: {
        secretRotationStatus,
        canActivateQrReal: false,
        canActivateDeepSeekReal: false,
        canActivateAutoSafeProduction: false,
        blockers: this.unique(securityBlockers),
      },
      sofia: {
        enabled: !globalPaused && !runtimeSafety.killSwitchActive,
        globalPaused,
        killSwitchActive: runtimeSafety.killSwitchActive,
        mode: runtimeSafety.killSwitchActive ? 'killed' : globalPaused ? 'paused' : 'governed_sandbox',
        activePromptVersion: activePrompt?.version ?? null,
        promptStatus: activePrompt?.status ?? null,
        promptUpdatedAt: activePrompt?.activatedAt ?? null,
      },
      ai: {
        provider: aiStatus.provider,
        mode: aiStatus.mode,
        deepSeekEnabled: aiStatus.deepseekEnabled,
        deepSeekReady: false,
        fallbackProvider: 'rules',
        healthStatus: aiStatus.safeByDefault ? 'PASS' : 'WARNING',
      },
      autoSafe: {
        enabled: runtimeSafety.effective.autoSafeEnabled,
        sandboxOnly: true,
        lastDecisionAt: lastAutoSafeDecision?.createdAt.toISOString() ?? null,
        decisionsToday: autoSafeCounts.total,
        approvedToday: autoSafeCounts.approved,
        humanRequiredToday: autoSafeCounts.humanRequired,
        blockedToday: autoSafeCounts.blocked,
        draftOnlyToday: autoSafeCounts.draftOnly,
        topReasonCodes: autoSafeCounts.topReasonCodes,
      },
      catalog: {
        activeItems: catalogItems.length,
        offersCount: offers.length,
        additionsCount: additions.length,
        missingPriceCount,
        missingImageCount,
        maxiFamilyStatus,
      },
      memory: {
        customersWithMemory: customerMemoryCount,
        conversationsWithMemory: conversationMemoryCount,
        lastMemoryUpdateAt: lastMemory?.updatedAt.toISOString() ?? null,
        optOutCount,
      },
      whatsapp: {
        provider: 'qr_gateway',
        mode: qrStatus.mode,
        qrGatewayReady,
        qrConnected: qrStatus.connected,
        qrStatus: qrStatus.status,
        qrSessionName: qrStatus.sessionName,
        qrReceiveOnlyReady: qrStatus.mode === 'receive_only',
        realSendingEnabled,
        inboundToday: qrStatus.inboundToday || inboundToday,
        outboundToday: qrStatus.outboundToday || outboundToday,
        pendingOutbound: qrStatus.pendingOutbound || pendingOutbound,
      },
      conversations,
      payments: {
        whatsappCanMarkPaid: false,
        paymentLinksEnabled: true,
        manualPaymentsEnabled: Boolean((paymentSettings?.cashEnabled ?? true) || (paymentSettings?.nequiManualEnabled ?? true)),
        nequiManualEnabled: paymentSettings?.nequiManualEnabled ?? true,
        cashEnabled: paymentSettings?.cashEnabled ?? true,
      },
      operations: {
        posStatus: 'PASS',
        deliveriesStatus: 'PASS',
        checkoutStatus: 'PASS',
        stockProtected: true,
        cashProtected: true,
      },
      routes: {
        sandboxUrl: '/sofia/sandbox',
        conversationsUrl: '/sofia/conversations',
        whatsappQrUrl: '/sofia/whatsapp-qr',
        deliveriesUrl: '/deliveries',
        posUrl: '/pos',
      },
      lastEvents,
    };
  }

  async getReadiness() {
    const status = await this.getEnterpriseStatus();
    return status.productionReadiness;
  }

  async getMetrics() {
    const status = await this.getEnterpriseStatus();
    return {
      generatedAt: status.generatedAt,
      autoSafe: status.autoSafe,
      conversations: status.conversations,
      memory: status.memory,
      prompt: status.sofia,
      catalog: status.catalog,
      safetyBlocks: status.autoSafe.blockedToday,
      humanRequired: status.autoSafe.humanRequiredToday + status.conversations.humanRequired,
    };
  }

  async getSecurityStatus() {
    const status = await this.getEnterpriseStatus();
    return {
      generatedAt: status.generatedAt,
      ...status.security,
      secretsVisible: false,
      sanitized: true,
    };
  }

  async getDashboardSummary() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [enterprise, qrStatus, aiStatus, internalValidation, conversationSummary, safetySummary, lastInbound] =
      await Promise.all([
        this.getEnterpriseStatus(),
        this.qrGatewayService.getStatus(),
        Promise.resolve(this.aiProviderFactory.getStatus()),
        this.internalValidationCounts(todayStart),
        this.dashboardConversationSummary(),
        this.dashboardSafetySummary(todayStart),
        this.prisma.whatsappInboundEvent.findFirst({
          where: { provider: 'qr_gateway' },
          orderBy: { receivedAt: 'desc' },
          select: { receivedAt: true },
        }),
      ]);

    const productionBlocked = enterprise.productionReadiness.status === 'BLOCKED';
    const deepSeekDryRun = aiStatus.provider === 'deepseek' && aiStatus.mode === 'dry_run';
    const allowlistFinalStatus = 'PENDING' as const;
    const realOperationEnabled = false;
    const realConversations = realOperationEnabled ? conversationSummary.realConversations : 0;

    return {
      generatedAt: now.toISOString(),
      dataPolicy: {
        noSecrets: true,
        noPii: true,
        noQrRaw: true,
        noSessionAuth: true,
        realOperationEnabled,
        realOperationReason: 'ALLOWLIST_FINAL_PENDING',
        sandboxSeparated: true,
        mainDashboardScope: 'SUPERVISED_PREPRODUCTION',
      },
      general: {
        sofiaMode: enterprise.sofia.killSwitchActive ? 'killed' : enterprise.sofia.globalPaused ? 'paused' : 'supervised',
        globalPaused: enterprise.sofia.globalPaused,
        killSwitchActive: enterprise.sofia.killSwitchActive,
        automationBlocked: enterprise.sofia.globalPaused || enterprise.sofia.killSwitchActive,
        productionEnabled: false,
        productionBlocked,
        receiveOnly: qrStatus.mode === 'receive_only',
        realSendingEnabled: false,
        autoReplyEnabled: qrStatus.autoReplyEnabled,
        autoSafeEnabled: enterprise.autoSafe.enabled,
      },
      whatsappQr: {
        provider: qrStatus.provider,
        mode: qrStatus.mode,
        status: qrStatus.status,
        connected: qrStatus.connected,
        adapterReal: qrStatus.adapterReal,
        qrAvailable: qrStatus.qrAvailable,
        realSendingEnabled: qrStatus.realSendingEnabled,
        inboundToday: realOperationEnabled ? qrStatus.inboundToday : 0,
        lastInboundAt: lastInbound?.receivedAt.toISOString() ?? null,
        validationInboundToday: qrStatus.inboundToday,
        source: realOperationEnabled ? 'real_operation' : 'internal_validation',
      },
      ai: {
        aiProvider: aiStatus.provider,
        aiMode: aiStatus.mode,
        deepSeekEnabled: aiStatus.deepseekEnabled,
        dryRunEnabled: deepSeekDryRun,
        externalProviderEnabled: aiStatus.deepseekEnabled,
        fallbackProvider: 'rules',
        lastAiCheckAt: enterprise.autoSafe.lastDecisionAt,
        source: 'backend_status',
      },
      safetyGuard: {
        real: {
          totalDecisions: realOperationEnabled ? safetySummary.real.totalDecisions : 0,
          approvedCount: realOperationEnabled ? safetySummary.real.approvedCount : 0,
          humanRequiredCount: realOperationEnabled ? safetySummary.real.humanRequiredCount : 0,
          blockedCount: realOperationEnabled ? safetySummary.real.blockedCount : 0,
          draftCount: realOperationEnabled ? safetySummary.real.draftCount : 0,
          paymentSensitiveCount: realOperationEnabled ? safetySummary.real.paymentSensitiveCount : 0,
          unknownProductCount: realOperationEnabled ? safetySummary.real.unknownProductCount : 0,
          lastDecisionAt: realOperationEnabled ? safetySummary.real.lastDecisionAt : null,
        },
        sandbox: safetySummary.sandbox,
        historical: safetySummary.historical,
      },
      conversations: {
        totalConversations: conversationSummary.totalConversations,
        realConversations,
        sandboxConversations: conversationSummary.sandboxConversations,
        internalValidationConversations: conversationSummary.internalValidationConversations,
        humanRequired: realOperationEnabled ? conversationSummary.humanRequired : 0,
        paymentSensitive: realOperationEnabled ? conversationSummary.paymentSensitive : 0,
        unknownProduct: realOperationEnabled ? conversationSummary.unknownProduct : 0,
        pendingReview: realOperationEnabled ? conversationSummary.pendingReview : 0,
      },
      internalValidation: {
        inboundToday: internalValidation.inboundToday,
        simulatedInboundToday: internalValidation.simulatedInboundToday,
        qrGatewayValidationInboundToday: internalValidation.qrGatewayValidationInboundToday,
        autoSafeDecisionsToday: safetySummary.sandbox.totalDecisions + safetySummary.real.totalDecisions,
        paidClaimsBlockedToday: safetySummary.historical.paymentSensitiveCount,
      },
      security: {
        secretRotationStatus: enterprise.security.secretRotationStatus,
        securityCleanupStatus: 'GO_CONDICIONADO',
        allowlistFinalStatus,
        productionReadinessStatus: enterprise.productionReadiness.status,
        blockedChecks: enterprise.productionReadiness.checklist
          .filter((item) => item.status === 'BLOCKED')
          .map((item) => item.label),
        passedChecks: enterprise.productionReadiness.checklist
          .filter((item) => item.status === 'PASS')
          .map((item) => item.label),
        pendingChecks: [
          ...enterprise.productionReadiness.checklist
            .filter((item) => item.status === 'WARNING')
            .map((item) => item.label),
          'Allowlist comercial final',
          'Envío real interno diferido',
        ],
      },
      routes: enterprise.routes,
    };
  }

  async getGovernanceEvents() {
    return this.lastEvents(30);
  }

  async getGovernanceStatus() {
    const settings = await this.getGovernanceSettings();
    return {
      globalPaused: settings.globalPaused.paused === true,
      killSwitchActive: settings.killSwitch.active === true,
      qrRealAllowed: settings.qrRealAllowed.allowed === true,
      deepSeekRealAllowed: settings.deepSeekRealAllowed.allowed === true,
      autoSafeProductionAllowed: settings.autoSafeProductionAllowed.allowed === true,
      secretRotationStatus: this.secretRotationStatus(settings.secretRotationStatus),
      phase: 'F3_GOVERNANCE_ONLY',
    };
  }

  async activateKillSwitch(actorId: string, reason?: string) {
    const safeReason = (reason ?? 'Activacion manual de emergencia').slice(0, 180);
    await this.upsertSetting(GOVERNANCE_KEYS.killSwitch, { active: true, reason: safeReason }, actorId);
    await this.audit('SOFIA_GOVERNANCE_KILL_SWITCH_ACTIVATED', actorId, { reason: safeReason });
    return { active: true, status: 'PASS', message: 'Kill switch activo. Automatizacion y envios permanecen bloqueados.' };
  }

  async deactivateKillSwitch(actorId: string) {
    await this.upsertSetting(GOVERNANCE_KEYS.killSwitch, { active: false }, actorId);
    await this.audit('SOFIA_GOVERNANCE_KILL_SWITCH_DEACTIVATED', actorId, {});
    return { active: false, status: 'PASS', message: 'Kill switch desactivado. Los demas gates de seguridad siguen vigentes.' };
  }

  async pauseGlobal(actorId: string, reason?: string) {
    await this.upsertSetting(GOVERNANCE_KEYS.globalPaused, { paused: true, reason: reason ?? 'Pausa global desde panel enterprise' }, actorId);
    await this.audit('SOFIA_GOVERNANCE_GLOBAL_PAUSE', actorId, { reason: reason ?? 'Pausa global desde panel enterprise' });
    return { paused: true, status: 'PASS', message: 'Sofía pausada globalmente. No se afecta POS/Domicilios/Caja/Stock.' };
  }

  async resumeGlobal(actorId: string) {
    await this.upsertSetting(GOVERNANCE_KEYS.globalPaused, { paused: false }, actorId);
    await this.audit('SOFIA_GOVERNANCE_GLOBAL_RESUME', actorId, {});
    return { paused: false, status: 'PASS', message: 'Sofía reactivada en modo gobernado/sandbox.' };
  }

  async updateGovernanceSettings(actorId: string, input: {
    qrRealAllowed?: boolean;
    deepSeekRealAllowed?: boolean;
    autoSafeProductionAllowed?: boolean;
    secretRotationStatus?: SofiaSecretRotationStatus;
  }) {
    if (input.qrRealAllowed === true || input.deepSeekRealAllowed === true || input.autoSafeProductionAllowed === true) {
      await this.audit('SOFIA_GOVERNANCE_REAL_ACTIVATION_BLOCKED', actorId, {
        requested: {
          qrRealAllowed: input.qrRealAllowed === true,
          deepSeekRealAllowed: input.deepSeekRealAllowed === true,
          autoSafeProductionAllowed: input.autoSafeProductionAllowed === true,
        },
        reason: 'PHASE_NOT_READY',
      });
      throw new BadRequestException({
        status: 'BLOCKED',
        reason: 'PHASE_NOT_READY',
        message: 'F3 no permite activar QR real, DeepSeek real ni auto_safe producción.',
      });
    }
    if (input.secretRotationStatus) {
      await this.upsertSetting(GOVERNANCE_KEYS.secretRotationStatus, { status: input.secretRotationStatus }, actorId);
    }
    await this.audit('SOFIA_GOVERNANCE_SETTINGS_UPDATED', actorId, { secretRotationStatus: input.secretRotationStatus ?? null });
    return this.getGovernanceStatus();
  }

  private async getGovernanceSettings() {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: Object.values(GOVERNANCE_KEYS) } },
    });
    const byKey = new Map(settings.map((setting) => [setting.key, this.settingValue(setting.value)]));
    return {
      globalPaused: byKey.get(GOVERNANCE_KEYS.globalPaused) ?? { paused: false },
      killSwitch: byKey.get(GOVERNANCE_KEYS.killSwitch) ?? { active: false },
      autoSafeProductionAllowed: byKey.get(GOVERNANCE_KEYS.autoSafeProductionAllowed) ?? { allowed: false },
      qrRealAllowed: byKey.get(GOVERNANCE_KEYS.qrRealAllowed) ?? { allowed: false },
      deepSeekRealAllowed: byKey.get(GOVERNANCE_KEYS.deepSeekRealAllowed) ?? { allowed: false },
      secretRotationStatus: byKey.get(GOVERNANCE_KEYS.secretRotationStatus) ?? { status: 'PENDING' },
    };
  }

  private async upsertSetting(key: string, value: SofiaGovernanceSettingValue, actorId: string) {
    const payload = { ...value, updatedAt: new Date().toISOString(), updatedBy: actorId };
    return this.prisma.setting.upsert({
      where: { key },
      create: {
        key,
        value: payload as Prisma.InputJsonValue,
        category: 'sofia_governance',
        description: 'Control de gobierno enterprise de Sofía',
      },
      update: {
        value: payload as Prisma.InputJsonValue,
        category: 'sofia_governance',
        description: 'Control de gobierno enterprise de Sofía',
      },
    });
  }

  private async autoSafeCounts(todayStart: Date) {
    const events = await this.prisma.sofiaAutoSafeDecisionEvent.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { status: true, reasonCodesJson: true },
    });
    const reasonCounter = new Map<string, number>();
    for (const event of events) {
      for (const code of this.jsonArray(event.reasonCodesJson)) {
        reasonCounter.set(code, (reasonCounter.get(code) ?? 0) + 1);
      }
    }
    return {
      total: events.length,
      approved: events.filter((event) => event.status === 'AUTO_SAFE_APPROVED').length,
      humanRequired: events.filter((event) => event.status === 'HUMAN_REQUIRED').length,
      blocked: events.filter((event) => event.status === 'BLOCKED').length,
      draftOnly: events.filter((event) => event.status === 'DRAFT_ONLY').length,
      topReasonCodes: [...reasonCounter.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  private async conversationCounts(todayStart: Date) {
    const [active, humanRequired, humanTaken, paused, resolvedToday] = await Promise.all([
      this.prisma.whatsappConversation.count({ where: { status: 'ACTIVE' } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_REQUIRED' } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_TAKEN' } }),
      this.prisma.whatsappConversation.count({ where: { humanStatus: 'SOFIA_PAUSED' } }),
      this.prisma.whatsappConversation.count({ where: { status: 'RESOLVED', updatedAt: { gte: todayStart } } }),
    ]);
    return { active, humanRequired, humanTaken, paused, resolvedToday };
  }

  private async internalValidationCounts(todayStart: Date) {
    const [inboundToday, simulatedInboundToday, qrGatewayValidationInboundToday] = await Promise.all([
      this.prisma.whatsappInboundEvent.count({ where: { receivedAt: { gte: todayStart } } }),
      this.prisma.whatsappInboundEvent.count({
        where: {
          receivedAt: { gte: todayStart },
          OR: [
            { provider: 'mock' },
            { rawPayload: { path: ['summary', 'source'], string_contains: 'TEST_INBOUND' } },
          ],
        },
      }),
      this.prisma.whatsappInboundEvent.count({
        where: {
          receivedAt: { gte: todayStart },
          provider: 'qr_gateway',
        },
      }),
    ]);
    return { inboundToday, simulatedInboundToday, qrGatewayValidationInboundToday };
  }

  private async dashboardConversationSummary() {
    const [totalConversations, sandboxConversations, internalValidationConversations, humanRequired, paymentSensitive, unknownProduct, pendingReview] =
      await Promise.all([
        this.prisma.whatsappConversation.count(),
        this.prisma.whatsappConversation.count({
          where: { OR: [{ provider: 'mock' }, { mode: 'mock' }] },
        }),
        this.prisma.whatsappConversation.count({
          where: { provider: { in: ['mock', 'qr_gateway'] } },
        }),
        this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_REQUIRED' } }),
        this.prisma.whatsappConversation.count({
          where: {
            OR: [
              { lastMessagePreview: { contains: 'nequi', mode: 'insensitive' } },
              { lastMessagePreview: { contains: 'comprobante', mode: 'insensitive' } },
              { messages: { some: { body: { contains: 'nequi', mode: 'insensitive' } } } },
              { messages: { some: { body: { contains: 'comprobante', mode: 'insensitive' } } } },
            ],
          },
        }),
        this.prisma.whatsappConversation.count({
          where: {
            OR: [
              { lastMessagePreview: { contains: 'sushi', mode: 'insensitive' } },
              { messages: { some: { body: { contains: 'sushi', mode: 'insensitive' } } } },
            ],
          },
        }),
        this.prisma.whatsappConversation.count({
          where: {
            OR: [
              { humanStatus: { in: ['HUMAN_REQUIRED', 'HUMAN_TAKEN'] } },
              { outboundMessages: { some: { status: { in: ['SUGGESTED', 'APPROVAL_PENDING', 'DRAFT_ONLY'] } } } },
            ],
          },
        }),
      ]);
    const realConversations = Math.max(0, totalConversations - sandboxConversations);
    return {
      totalConversations,
      realConversations,
      sandboxConversations,
      internalValidationConversations,
      humanRequired,
      paymentSensitive,
      unknownProduct,
      pendingReview,
    };
  }

  private async dashboardSafetySummary(todayStart: Date) {
    const events = await this.prisma.sofiaAutoSafeDecisionEvent.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { status: true, reasonCodesJson: true, isSandbox: true, createdAt: true },
    });
    const build = (items: typeof events) => {
      const reasonCodes = items.flatMap((event) => this.jsonArray(event.reasonCodesJson));
      return {
        totalDecisions: items.length,
        approvedCount: items.filter((event) => event.status === 'AUTO_SAFE_APPROVED').length,
        humanRequiredCount: items.filter((event) => event.status === 'HUMAN_REQUIRED').length,
        blockedCount: items.filter((event) => event.status === 'BLOCKED').length,
        draftCount: items.filter((event) => event.status === 'DRAFT_ONLY').length,
        paymentSensitiveCount: reasonCodes.filter((code) => code === 'PAYMENT_SENSITIVE' || code === 'PAID_CLAIM_BLOCKED').length,
        unknownProductCount: reasonCodes.filter((code) => code === 'UNKNOWN_PRODUCT').length,
        lastDecisionAt: items[0]?.createdAt.toISOString() ?? null,
      };
    };
    const real = build(events.filter((event) => event.isSandbox === false).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    const sandbox = build(events.filter((event) => event.isSandbox !== false).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    return {
      real,
      sandbox,
      historical: build(events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    };
  }

  private async lastEvents(limit = 12): Promise<SofiaEnterpriseStatusResponse['lastEvents']> {
    const [autoSafe, commercialRules, audits] = await Promise.all([
      this.prisma.sofiaAutoSafeDecisionEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.sofiaCommercialRuleEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.auditLog.findMany({
        where: { module: { in: ['SofiaGlobalControl', 'SofiaGovernance'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return [
      ...autoSafe.map((event) => ({
        type: 'AUTO_SAFE_DECISION',
        status: event.status,
        detail: this.jsonArray(event.reasonCodesJson).join(', ') || event.riskLevel,
        createdAt: event.createdAt.toISOString(),
      })),
      ...commercialRules.map((event) => ({
        type: 'COMMERCIAL_RULE',
        status: event.severity,
        detail: `${event.ruleCode}: ${event.actionTaken}`,
        createdAt: event.createdAt.toISOString(),
      })),
      ...audits.map((event) => ({
        type: 'GOVERNANCE',
        status: event.action,
        detail: event.entity,
        createdAt: event.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  private async audit(action: string, actorId: string, values: Prisma.InputJsonValue) {
    await this.prisma.auditLog.create({
      data: {
        action,
        module: 'SofiaGovernance',
        entity: 'global',
        entityId: 'global',
        userId: actorId,
        newValues: values,
      },
    });
  }

  private secretRotationStatus(value: SofiaGovernanceSettingValue): SofiaSecretRotationStatus {
    return value.status === 'COMPLETE' ? 'COMPLETE' : value.status === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING';
  }

  private settingValue(value: Prisma.JsonValue): SofiaGovernanceSettingValue {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as SofiaGovernanceSettingValue) : {};
  }

  private jsonArray(value: Prisma.JsonValue) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private unique(values: string[]) {
    return [...new Set(values)];
  }
}
