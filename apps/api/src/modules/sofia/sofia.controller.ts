import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappDeliveryOrderStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { SofiaAIProviderFactory } from './ai/sofia-ai-provider.factory';
import { SofiaAlertsService } from './alerts/sofia-alerts.service';
import { SofiaAutoSafeEngineService } from './auto-safe/sofia-auto-safe-engine.service';
import { SofiaBackupsService } from './backups/sofia-backups.service';
import { SofiaCommercialCatalogService } from './catalog/sofia-commercial-catalog.service';
import {
  CreateMockConversationDto,
  CreateSofiaOrderDraftDto,
  EvaluateSofiaAutoSafeDto,
  MarkConversationHandoffDto,
  MockOutboundMessageDto,
  PauseSofiaGovernanceDto,
  ProcessSofiaAgentMessageDto,
  RecoverSofiaAbandonedDraftDto,
  TestSofiaAiProviderDto,
  UpdateSofiaGovernanceSettingsDto,
  UpdateSofiaOrderDraftDto,
  UpdateWhatsappDeliveryOrderStatusDto,
} from './dto/sofia.dto';
import { SofiaGovernanceService } from './governance/sofia-governance.service';
import { SofiaHardeningService } from './hardening/sofia-hardening.service';
import { SofiaHumanFeedbackService } from './learning/sofia-human-feedback.service';
import { SofiaLearningService } from './learning/sofia-learning.service';
import { SofiaCustomerMemoryService } from './memory/sofia-customer-memory.service';
import { SofiaMetricsService } from './metrics/sofia-metrics.service';
import { SofiaPromptService } from './prompt/sofia-prompt.service';
import { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import { SofiaAdminResponseSanitizerInterceptor } from './privacy/sofia-admin-response-sanitizer.interceptor';
import { SofiaRetentionService } from './retention/sofia-retention.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaService } from './sofia.service';
import { SofiaWhatsappService } from './sofia-whatsapp.service';

@Controller('admin/sofia')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SofiaAdminResponseSanitizerInterceptor)
@Roles('admin', 'cashier', 'supervisor')
@Permissions('orders.read')
export class SofiaController {
  constructor(
    private readonly sofiaService: SofiaService,
    private readonly sofiaAgentService: SofiaAgentService,
    private readonly sofiaWhatsappService: SofiaWhatsappService,
    private readonly aiProviderFactory: SofiaAIProviderFactory,
    private readonly autoSafeEngine: SofiaAutoSafeEngineService,
    private readonly promptService: SofiaPromptService,
    private readonly catalogService: SofiaCommercialCatalogService,
    private readonly customerMemoryService: SofiaCustomerMemoryService,
    private readonly governanceService: SofiaGovernanceService,
    private readonly metricsService: SofiaMetricsService,
    private readonly humanFeedbackService: SofiaHumanFeedbackService,
    private readonly learningService: SofiaLearningService,
    private readonly privacyService: SofiaPrivacyService,
    private readonly retentionService: SofiaRetentionService,
    private readonly alertsService: SofiaAlertsService,
    private readonly backupsService: SofiaBackupsService,
    private readonly hardeningService: SofiaHardeningService,
    private readonly configService: ConfigService,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
  ) {}

  @Get('prompt/active')
  getActivePrompt() {
    return this.promptService.getActivePrompt();
  }

  @Get('prompt/versions')
  listPromptVersions() {
    return this.promptService.listPromptVersions();
  }

  @Get('catalog')
  listCatalog() {
    return this.catalogService.listActiveItems();
  }

  @Get('catalog/:slug')
  findCatalogItem(@Param('slug') slug: string) {
    return this.catalogService.findBySlug(slug);
  }

  @Post('sandbox/commercial-message')
  @UseGuards(SofiaTestOnlyGuard)
  processCommercialSandbox(
    @Body() dto: ProcessSofiaAgentMessageDto,
    @CurrentUser() actor: AuthUser,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.sofiaAgentService.processSandboxMessage(dto, actor.sub, { headers });
  }

  @Post('sandbox/auto-safe-evaluate')
  @UseGuards(SofiaTestOnlyGuard)
  async evaluateAutoSafe(
    @Body() dto: EvaluateSofiaAutoSafeDto,
    @CurrentUser() actor: AuthUser,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (!dto.candidateReply) {
      const result = await this.sofiaAgentService.processSandboxMessage(
        {
          phone: dto.phone ?? '573009980000',
          customerName: 'Cliente Auto Safe',
          message: dto.messageText,
          messageType: 'TEXT',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        },
        actor.sub,
        { headers },
      );
      return {
        decision: result.autoSafeDecision,
        reasonCodes: result.autoSafeDecision.reasonCodes,
        finalReply: result.autoSafeDecision.finalReply,
        promptVersion: result.promptVersion,
        catalogMatches: result.matchedCatalogItem ? [result.matchedCatalogItem] : [],
        memorySummary: result.memory.customer.memorySummary,
        safetyGuardSummary: result.aiProvider,
        noWhatsappReal: true,
      };
    }

    const [prompt, catalogMatch, memory] = await Promise.all([
      this.promptService.getActivePrompt(),
      this.catalogService.findByText(dto.messageText),
      dto.phone ? this.customerMemoryService.resolveOrCreateMemory(dto.phone, null) : Promise.resolve(null),
    ]);
    const decision = await this.autoSafeEngine.evaluate({
      conversationId: null,
      customerMemoryId: memory?.id ?? null,
      promptVersionId: prompt.id,
      phoneNormalized: memory?.phoneNormalized ?? null,
      messageText: dto.messageText,
      candidateReply: dto.candidateReply,
      intent: dto.simulateOrderIntent ?? 'UNKNOWN',
      confidence: dto.simulateConfidence ?? 0.9,
      productsMentioned: [],
      catalogItems: catalogMatch ? [catalogMatch] : [],
      memorySnapshot: dto.simulateMemory ?? (memory ? this.customerMemoryService.toSnapshot(memory) : null),
      conversationState: dto.simulateConversationState ?? 'SOFIA_ACTIVE',
      promptVersion: prompt.version,
      paymentIntent: dto.simulatePaymentIntent ?? null,
      orderIntent: { simulateOrderIntent: dto.simulateOrderIntent ?? null },
      missingFields: [],
      safetyGuardResult: {
        blocked: false,
        safetyFlags: [],
        forbiddenClaimsDetected: [],
        diagnostics: ['AUTO_SAFE_DIRECT_SANDBOX_EVALUATION'],
      },
      channelMode: dto.simulateChannelMode ?? 'sandbox',
      isSandbox: dto.sandbox ?? true,
      isHumanTaken: dto.simulateConversationState === 'HUMAN_TAKEN',
      isSofiaPaused: dto.simulateConversationState === 'SOFIA_PAUSED',
      autoSafeEnabled: dto.autoSafeEnabled ?? true,
      secretRotationPending: dto.secretRotationPending ?? false,
      qrReady: dto.qrReady ?? false,
      deepSeekReady: dto.deepSeekReady ?? false,
      businessStatus: { isOpen: true, timezone: 'America/Bogota', schedule: '5:00 p.m. a 12:00 a.m.' },
      metadata: { noWhatsappReal: true, directEvaluation: true },
    });

    return {
      decision,
      reasonCodes: decision.reasonCodes,
      finalReply: decision.finalReply,
      promptVersion: prompt.version,
      catalogMatches: catalogMatch ? [catalogMatch] : [],
      memorySummary: memory ? this.customerMemoryService.toSnapshot(memory).memorySummary : null,
      safetyGuardSummary: decision.auditJson,
      noWhatsappReal: true,
    };
  }

  @Get('ai/status')
  getAiStatus(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.aiProviderFactory.getStatus(headers);
  }

  @Post('ai/health-check')
  healthCheckAi(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.aiProviderFactory.healthCheck(headers);
  }

  @Post('ai/test')
  @UseGuards(SofiaTestOnlyGuard)
  testAiProvider(
    @Body() dto: TestSofiaAiProviderDto,
    @CurrentUser() actor: AuthUser,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const aiHeaders = {
      ...headers,
      ...(dto.provider ? { 'x-sofia-ai-provider': dto.provider } : {}),
      ...(dto.mode ? { 'x-sofia-ai-mode': dto.mode } : {}),
      ...(dto.scenario ? { 'x-sofia-ai-mock-scenario': dto.scenario } : {}),
    };
    return this.sofiaAgentService.processSandboxMessage(
      {
        phone: dto.phone ?? '573009990000',
        customerName: dto.customerName ?? 'Cliente IA',
        message: dto.message,
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      },
      actor.sub,
      { headers: aiHeaders },
    );
  }

  @Get('whatsapp/status')
  getWhatsappStatus() {
    return this.sofiaWhatsappService.getStatus();
  }

  @Post('agent/process')
  @UseGuards(SofiaTestOnlyGuard)
  processAgentMessage(
    @Body() dto: ProcessSofiaAgentMessageDto,
    @CurrentUser() actor: AuthUser,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.sofiaAgentService.processSandboxMessage(dto, actor.sub, { headers });
  }

  @Post('agent/recover-abandoned')
  @UseGuards(SofiaTestOnlyGuard)
  recoverAbandonedDraft(@Body() dto: RecoverSofiaAbandonedDraftDto) {
    return this.sofiaAgentService.recoverAbandonedDraft(dto);
  }

  @Get('conversations')
  listConversations() {
    return this.sofiaService.listConversations();
  }

  @Get('conversations/inbox')
  getConversationsInbox() {
    return this.sofiaService.getConversationsInbox();
  }

  @Get('conversations/inbox/:id')
  getConversationInbox(@Param('id') id: string) {
    return this.sofiaService.getConversationInbox(id);
  }

  @Get('conversations/:id')
  findConversation(@Param('id') id: string) {
    return this.sofiaService.findConversation(id);
  }

  @Post('conversations/mock-inbound')
  @UseGuards(SofiaTestOnlyGuard)
  mockInbound(@Body() dto: CreateMockConversationDto, @CurrentUser() actor: AuthUser) {
    return this.sofiaService.registerMockInbound(dto, actor.sub);
  }

  @Post('conversations/:id/mock-outbound')
  @UseGuards(SofiaTestOnlyGuard)
  mockOutbound(
    @Param('id') id: string,
    @Body() dto: MockOutboundMessageDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sofiaService.registerMockOutbound(id, dto.body, dto.rawPayload, actor.sub);
  }

  @Post('conversations/:id/handoff')
  @Permissions('orders.update')
  handoff(
    @Param('id') id: string,
    @Body() dto: MarkConversationHandoffDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sofiaService.handoffConversation(id, dto.assignedToUserId, actor.sub);
  }

  @Post('conversations/:id/resolve')
  @Permissions('orders.update')
  resolve(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaService.resolveConversation(id, actor.sub);
  }

  @Post('conversations/:id/pause')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  pauseConversation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.pauseConversation(id, actor.sub);
  }

  @Post('conversations/:id/resume')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  resumeConversation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.resumeConversation(id, actor.sub);
  }

  @Post('conversations/:id/take-over')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  takeOverConversation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.takeOverConversation(id, actor.sub);
  }

  @Post('conversations/:id/release')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  releaseConversation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.releaseConversation(id, actor.sub);
  }

  @Post('outbound/:id/approve-send')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  approveOutbound(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.approveSend(id, actor.sub);
  }

  @Post('outbound/:id/cancel')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  cancelOutbound(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaWhatsappService.cancelOutbound(id, actor.sub);
  }

  @Post('outbound/:id/retry')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  retryOutbound(@Param('id') id: string) {
    return this.sofiaWhatsappService.retryOutbound(id);
  }

  @Post('order-drafts')
  @Permissions('orders.create')
  createDraft(@Body() dto: CreateSofiaOrderDraftDto, @CurrentUser() actor: AuthUser) {
    return this.sofiaService.createDraft(dto, actor.sub);
  }

  @Get('order-drafts')
  listDrafts() {
    return this.sofiaService.listDrafts();
  }

  @Get('order-drafts/:id')
  findDraft(@Param('id') id: string) {
    return this.sofiaService.findDraft(id);
  }

  @Patch('order-drafts/:id')
  @Permissions('orders.update')
  updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateSofiaOrderDraftDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sofiaService.updateDraft(id, dto, actor.sub);
  }

  @Post('order-drafts/:id/confirm')
  @Permissions('orders.update')
  confirmDraft(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaService.confirmDraft(id, actor.sub);
  }

  @Post('order-drafts/:id/cancel')
  @Permissions('orders.update')
  cancelDraft(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.sofiaService.cancelDraft(id, actor.sub);
  }

  @Post('delivery-orders/from-draft/:draftId')
  @Roles('admin', 'supervisor')
  @Permissions('orders.create', 'delivery.update')
  createDeliveryOrderFromDraft(
    @Param('draftId') draftId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sofiaService.createDeliveryOrderFromDraft(draftId, actor.sub);
  }

  @Get('delivery-orders')
  listDeliveryOrders() {
    return this.sofiaService.listDeliveryOrders();
  }

  @Get('delivery-orders/:id')
  findDeliveryOrder(@Param('id') id: string) {
    return this.sofiaService.findDeliveryOrder(id);
  }

  @Patch('delivery-orders/:id/status')
  @Roles('admin', 'supervisor')
  @Permissions('delivery.update')
  updateDeliveryOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateWhatsappDeliveryOrderStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sofiaService.updateDeliveryOrderStatus(id, dto.status as WhatsappDeliveryOrderStatus, actor.sub);
  }

  /* ------------------------------------------------------------------ */
  /*  Learning / Metrics / Hardening F6                                  */
  /* ------------------------------------------------------------------ */

  @Get('metrics/summary')
  @Roles('admin')
  getMetricsSummary(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.getSummary(range ?? 'today');
  }

  @Get('metrics/auto-safe')
  @Roles('admin')
  getAutoSafeMetrics(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.getAutoSafe(range ?? 'today');
  }

  @Get('metrics/conversations')
  @Roles('admin')
  getConversationMetrics(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.getConversations(range ?? 'today');
  }

  @Get('metrics/qr')
  @Roles('admin')
  getQrMetrics(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.getQr(range ?? 'today');
  }

  @Get('metrics/safety')
  @Roles('admin')
  getSafetyMetrics(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.getSafety(range ?? 'today');
  }

  @Get('metrics/export-sanitized')
  @Roles('admin')
  exportMetricsSanitized(@Query('range') range?: 'today' | '7d' | '30d') {
    return this.metricsService.exportSanitized(range ?? 'today');
  }

  @Post('learning/feedback')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createLearningFeedback(@Body() dto: Record<string, unknown>, @CurrentUser() actor: AuthUser) {
    return this.humanFeedbackService.createFeedback(
      {
        conversationId: typeof dto.conversationId === 'string' ? dto.conversationId : null,
        messageId: typeof dto.messageId === 'string' ? dto.messageId : null,
        autoSafeDecisionEventId: typeof dto.autoSafeDecisionEventId === 'string' ? dto.autoSafeDecisionEventId : null,
        customerMemoryId: typeof dto.customerMemoryId === 'string' ? dto.customerMemoryId : null,
        feedbackType: typeof dto.feedbackType === 'string' ? dto.feedbackType : 'OTHER',
        rating: typeof dto.rating === 'number' ? dto.rating : null,
        correctedReply: typeof dto.correctedReply === 'string' ? dto.correctedReply : null,
        notes: typeof dto.notes === 'string' ? dto.notes : null,
        tags: Array.isArray(dto.tags) ? dto.tags.map(String) : [],
      },
      actor.sub,
    );
  }

  @Get('learning/feedback')
  @Roles('admin', 'supervisor')
  listLearningFeedback(@Query('limit') limit?: string) {
    return this.humanFeedbackService.listFeedback(limit ? Number(limit) : 50);
  }

  @Get('learning/insights')
  @Roles('admin', 'supervisor')
  getLearningInsights() {
    return this.learningService.insights();
  }

  @Get('privacy/status')
  @Roles('admin')
  getPrivacyStatus() {
    return this.privacyService.status();
  }

  @Post('privacy/redact-preview')
  @Roles('admin')
  redactPreview(@Body() dto: Record<string, unknown>) {
    return this.privacyService.sanitizeJson(dto);
  }

  @Get('retention/status')
  @Roles('admin')
  getRetentionStatus() {
    return this.retentionService.status();
  }

  @Post('retention/dry-run')
  @Roles('admin')
  retentionDryRun() {
    return this.retentionService.dryRun();
  }

  @Post('retention/run')
  @Roles('admin')
  @Permissions('settings.update')
  retentionRun(@Body() dto: Record<string, unknown>, @CurrentUser() actor: AuthUser) {
    return this.retentionService.run({ confirm: dto.confirm === true }, actor.sub);
  }

  @Get('alerts')
  @Roles('admin', 'supervisor')
  listSofiaAlerts() {
    return this.alertsService.list();
  }

  @Post('alerts/check')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  checkSofiaAlerts() {
    return this.alertsService.check();
  }

  @Post('alerts/:id/ack')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  ackSofiaAlert(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.alertsService.ack(id, actor.sub);
  }

  @Get('backups/status')
  @Roles('admin')
  getSofiaBackupsStatus() {
    return this.backupsService.status();
  }

  @Post('backups/dry-run')
  @Roles('admin')
  @Permissions('settings.update')
  runSofiaBackupDryRun(@CurrentUser() actor: AuthUser) {
    return this.backupsService.dryRun(actor.sub);
  }

  @Get('hardening/status')
  @Roles('admin')
  getSofiaHardeningStatus() {
    return this.hardeningService.status();
  }

  /* ------------------------------------------------------------------ */
  /*  Enterprise Status                                                  */
  /* ------------------------------------------------------------------ */

  @Get('enterprise-status')
  async getEnterpriseStatus() {
    return this.governanceService.getEnterpriseStatus();
  }

  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.governanceService.getDashboardSummary();
  }

  /* ------------------------------------------------------------------ */
  /*  Kill-switch global                                                 */
  /* ------------------------------------------------------------------ */

  @Post('control/pause-global')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  async pauseGlobal(@Body('reason') reason: string, @CurrentUser() actor: AuthUser) {
    return this.governanceService.pauseGlobal(actor.sub, reason);
  }

  @Post('control/resume-global')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  async resumeGlobal(@CurrentUser() actor: AuthUser) {
    return this.governanceService.resumeGlobal(actor.sub);
  }

  @Get('control/status')
  async getControlStatus() {
    return this.governanceService.getGovernanceStatus();
  }

  @Get('readiness')
  getReadiness() {
    return this.governanceService.getReadiness();
  }

  @Get('metrics')
  getGovernanceMetrics() {
    return this.governanceService.getMetrics();
  }

  @Get('security-status')
  getSecurityStatus() {
    return this.governanceService.getSecurityStatus();
  }

  @Get('runtime-safety')
  getRuntimeSafety() {
    return this.runtimeSafetyService.getPublicStatus();
  }

  @Post('control/kill-switch/activate')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  activateKillSwitch(@Body('reason') reason: string, @CurrentUser() actor: AuthUser) {
    return this.governanceService.activateKillSwitch(actor.sub, reason);
  }

  @Post('control/kill-switch/deactivate')
  @Roles('admin')
  @Permissions('settings.update')
  deactivateKillSwitch(@CurrentUser() actor: AuthUser) {
    return this.governanceService.deactivateKillSwitch(actor.sub);
  }

  @Get('governance/events')
  getGovernanceEvents() {
    return this.governanceService.getGovernanceEvents();
  }

  @Get('governance/status')
  getGovernanceStatus() {
    return this.governanceService.getGovernanceStatus();
  }

  @Post('governance/pause')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  pauseGovernance(@Body() dto: PauseSofiaGovernanceDto, @CurrentUser() actor: AuthUser) {
    return this.governanceService.pauseGlobal(actor.sub, dto.reason);
  }

  @Post('governance/resume')
  @Roles('admin', 'supervisor')
  @Permissions('settings.update')
  resumeGovernance(@CurrentUser() actor: AuthUser) {
    return this.governanceService.resumeGlobal(actor.sub);
  }

  @Post('governance/settings')
  @Roles('admin')
  @Permissions('settings.update')
  updateGovernanceSettings(@Body() dto: UpdateSofiaGovernanceSettingsDto, @CurrentUser() actor: AuthUser) {
    return this.governanceService.updateGovernanceSettings(actor.sub, dto);
  }
}
