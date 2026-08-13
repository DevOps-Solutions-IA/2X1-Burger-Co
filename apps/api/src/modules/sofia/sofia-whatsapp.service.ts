import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  SofiaOrderSource,
  WhatsappConversationStatus,
  WhatsappMessageType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaCrmService } from './crm/sofia-crm.service';
import { TrustedCrmCustomerResolutionCapability } from './crm/crm-customer-resolution.capability';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { WhatsappProviderFactory } from './whatsapp/whatsapp-provider.factory';
import { ParsedWhatsappInbound, WhatsappMode, WhatsappProviderName } from './whatsapp/whatsapp-provider.adapter';
import { WhatsappHandoffService } from './whatsapp/production/whatsapp-handoff.service';
import { WhatsappInboundGateway } from './whatsapp/production/whatsapp-inbound.gateway';
import { WhatsappMessagePolicyService } from './whatsapp/production/whatsapp-message-policy.service';
import { WhatsappMediaSecurityService } from './whatsapp/production/whatsapp-media-security.service';
import { WhatsappProviderHealthService } from './whatsapp/production/whatsapp-provider-health.service';
import { sanitizeWhatsappInboundReceipt } from './whatsapp/production/whatsapp-inbound-receipt';
import { PrismaWhatsappConversationRepository } from './whatsapp/production/persistence/prisma-whatsapp-conversation.repository';
import {
  createWhatsappInboundConversationCheckpoint,
  createWhatsappInboundConversationStartedCheckpoint,
  parseWhatsappInboundDurableCheckpoint,
  type WhatsappInboundConversationCheckpoint,
} from './whatsapp/production/whatsapp-inbound-conversation-checkpoint';
import type { WhatsappInboundClaimContext } from './whatsapp/production/whatsapp-production.repository';

type HeaderMap = Record<string, string | string[] | undefined>;

type WhatsappInboundProcessingResult = {
  duplicate?: boolean;
  mode: WhatsappMode | string;
  provider: WhatsappProviderName;
  processingStatus?: string;
  conversationId?: string;
  inboundMessageId?: string;
  inboundEventId: string;
  outbound?: { status?: string; body?: string } | null;
  sofiaResult?: unknown;
  errorMessage?: string | null;
  realSendingEnabled?: boolean;
  noWhatsappReal?: boolean;
  replay?: unknown;
  [key: string]: unknown;
};

const PAUSED_STATUSES: WhatsappConversationStatus[] = [
  WhatsappConversationStatus.HUMAN_REQUIRED,
  WhatsappConversationStatus.HUMAN_TAKEN,
  WhatsappConversationStatus.SOFIA_PAUSED,
];
const INBOUND_AGENT_HEARTBEAT_MS = 30_000;

@Injectable()
export class SofiaWhatsappService {
  private readonly logger = new Logger(SofiaWhatsappService.name);

  constructor(
    private readonly conversations: PrismaWhatsappConversationRepository,
    private readonly providerFactory: WhatsappProviderFactory,
    private readonly sofiaAgentService: SofiaAgentService,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
    private readonly crmService: SofiaCrmService,
    private readonly inboundGateway: WhatsappInboundGateway,
    private readonly providerHealth: WhatsappProviderHealthService,
    private readonly messagePolicy: WhatsappMessagePolicyService,
    private readonly handoffService: WhatsappHandoffService,
    private readonly mediaSecurity: WhatsappMediaSecurityService,
  ) {}

  getStatus() {
    return this.providerFactory.getStatus();
  }

  async processInboundWebhook(
    providerParam: string,
    rawPayload: Record<string, unknown>,
    headers: HeaderMap,
    options: { trustedInternalValidation?: boolean; trustedBaileysTransport?: boolean; rawBody?: Buffer } = {},
  ): Promise<WhatsappInboundProcessingResult> {
    const mode = this.providerFactory.resolveMode(headers);
    const providerName = this.providerFactory.resolveProviderName(providerParam, headers);
    const provider = this.providerFactory.getProvider(providerName);
    let parsed = provider.parseInboundWebhook(rawPayload, headers);
    const effectiveProvider = provider.provider;

    if (
      effectiveProvider === 'qr_gateway' &&
      !options.trustedInternalValidation &&
      !options.trustedBaileysTransport
    ) {
      throw new UnauthorizedException('QR Gateway solo acepta eventos del transporte Baileys interno.');
    }

    if (effectiveProvider === 'mock' && process.env.NODE_ENV !== 'test') {
      throw new UnauthorizedException('El provider mock no acepta webhooks fuera de tests.');
    }

    if (effectiveProvider === 'hermes' && !provider.verifyWebhookSignature(rawPayload, headers, options.rawBody)) {
      await this.runtimeSafetyService.recordBlocked('INBOUND_ANALYSIS', {
        phone: parsed.phone,
        reason: 'WHATSAPP_SIGNATURE_INVALID',
        idempotencyKey: this.hashPayload(parsed, 'signature-invalid'),
      });
      throw new UnauthorizedException('Webhook WhatsApp no autorizado.');
    }

    if (!['qr_gateway', 'hermes', 'mock'].includes(effectiveProvider)) {
      throw new BadRequestException({ code: 'WHATSAPP_PROVIDER_UNSUPPORTED' });
    }
    const accountObservation = this.providerHealth.observation(
      effectiveProvider as 'qr_gateway' | 'hermes' | 'mock',
      rawPayload,
    );
    const ingress = await this.inboundGateway.receive({ provider: effectiveProvider, rawPayload, parsed, account: accountObservation });
    if (ingress.terminal) {
      if (ingress.claim.state === 'DETERMINISTIC_REPLAY') {
        const eventHash = ingress.event.payloadHash;
        if (ingress.event.kind === 'INBOUND_MESSAGE') {
          await this.runtimeSafetyService.recordBlocked('DUPLICATE_INBOUND', {
            phone: ingress.event.sender,
            reason: 'DUPLICATE_IGNORED',
            idempotencyKey: eventHash,
          });
        }
      }
      const receipt = {
        duplicate: ingress.claim.state === 'DETERMINISTIC_REPLAY',
        mode,
        provider: effectiveProvider,
        inboundEventId: ingress.claim.inboundEventId,
        processingStatus:
          ingress.claim.state === 'DETERMINISTIC_REPLAY'
            ? 'DUPLICATE_IGNORED'
            : String((ingress.result as Record<string, unknown> | null)?.processingStatus ?? 'ACKNOWLEDGED'),
        replay: ingress.claim.state === 'DETERMINISTIC_REPLAY' ? ingress.result : undefined,
        ...(ingress.claim.state === 'DETERMINISTIC_REPLAY'
          ? {}
          : (ingress.result as Record<string, unknown>)),
      };
      return options.trustedInternalValidation || process.env.NODE_ENV === 'test'
        ? receipt
        : sanitizeWhatsappInboundReceipt(receipt);
    }
    if (ingress.event.kind !== 'INBOUND_MESSAGE') {
      throw new BadRequestException({ code: 'WHATSAPP_EVENT_CLASSIFICATION_INVALID' });
    }
    if (ingress.claim.state !== 'CLAIMED') {
      throw new BadRequestException({ code: 'WHATSAPP_INBOUND_CLAIM_CONTEXT_INVALID' });
    }
    parsed = {
      ...parsed,
      phone: ingress.event.sender,
      body: ingress.event.messageType === 'AUDIO' ? null : ingress.event.sanitizedText,
      transcript: ingress.event.messageType === 'AUDIO' ? ingress.event.sanitizedText : null,
    };
    try {
    if (!parsed.phone) {
      await this.inboundGateway.complete(ingress.claim, 'REJECTED', { processingStatus: 'REJECTED' }, 'WHATSAPP_PHONE_REQUIRED');
      throw new BadRequestException('El webhook WhatsApp no incluye teléfono válido.');
    }
    const eventHash = ingress.event.payloadHash;
    const inboundEvent = { id: ingress.claim.inboundEventId };

    const allowlist = options.trustedInternalValidation
      ? { allowed: true, reason: 'INTERNAL_VALIDATION_BYPASS' as const, phoneMasked: null, phoneHash: null }
      : this.runtimeSafetyService.evaluateAllowlist(parsed.phone);
    if (effectiveProvider === 'qr_gateway' && !allowlist.allowed) {
      const conversation = await this.getOrCreateWhatsappConversation(
        parsed,
        'receive_only',
        effectiveProvider,
        options.trustedInternalValidation ? SofiaOrderSource.MOCK_ADMIN : SofiaOrderSource.WHATSAPP,
      );
      const inboundMessage = await this.conversations.createInboundMessage({
          conversationId: conversation.id,
          type: parsed.messageType as WhatsappMessageType,
          provider: effectiveProvider,
          providerMessageId: parsed.providerMessageId ?? null,
          providerTimestamp: parsed.timestamp ?? null,
          body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
          mediaMimeType: parsed.mediaMimeType ?? null,
          transcript: parsed.transcript ?? null,
          payloadHash: eventHash,
          status: 'PILOT_NOT_ALLOWED',
          idempotencyKey: `inbound:${eventHash}`,
          errorMessage: 'ALLOWLIST_REQUIRED',
      });

      await this.handoffService.transition({
        conversationId: conversation.id,
        actorId: await this.systemActorId(),
        target: 'PILOT_NOT_ALLOWED',
        reasonCode: 'ALLOWLIST_REQUIRED',
      });
      await this.conversations.flagConversation(conversation.id, {
            reason: 'ALLOWLIST_REQUIRED',
            receiveOnly: true,
            noWhatsappRealSent: true,
      });
      await this.runtimeSafetyService.recordBlocked('ALLOWLIST', {
        phone: parsed.phone,
        reason: allowlist.reason,
        idempotencyKey: eventHash,
      });

      const response = {
        duplicate: false,
        mode: 'receive_only',
        provider: effectiveProvider,
        processingStatus: 'ALLOWLIST_REQUIRED',
        conversationId: conversation.id,
        inboundMessageId: inboundMessage.id,
        inboundEventId: inboundEvent.id,
        outbound: null,
        sofiaResult: null,
        errorMessage: 'ALLOWLIST_REQUIRED',
        realSendingEnabled: false,
        noWhatsappReal: true,
      };
      const receipt = sanitizeWhatsappInboundReceipt(response);
      await this.inboundGateway.complete(ingress.claim, 'ALLOWLIST_REQUIRED', receipt, 'ALLOWLIST_REQUIRED');
      return options.trustedInternalValidation || process.env.NODE_ENV === 'test' ? response : receipt;
    }
    const conversation = await this.getOrCreateWhatsappConversation(
      parsed,
      mode,
      effectiveProvider,
      options.trustedInternalValidation ? SofiaOrderSource.MOCK_ADMIN : SofiaOrderSource.WHATSAPP,
    );
    const inboundMessage = await this.conversations.createInboundMessage({
        conversationId: conversation.id,
        type: parsed.messageType as WhatsappMessageType,
        provider: effectiveProvider,
        providerMessageId: parsed.providerMessageId ?? null,
        providerTimestamp: parsed.timestamp ?? null,
        body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
        mediaMimeType: parsed.mediaMimeType ?? null,
        transcript: parsed.transcript ?? null,
        payloadHash: eventHash,
        status: 'RECEIVED',
        idempotencyKey: `inbound:${eventHash}`,
    });
    if (ingress.event.media) await this.mediaSecurity.persist(inboundMessage.id, ingress.event.media);

    const result = await this.handleInboundMode({
      mode,
      providerName: effectiveProvider,
      parsed,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      accountId: ingress.account.id,
      headers,
      eventHash,
      claim: ingress.claim,
    });

    const response = {
      mode,
      provider: effectiveProvider,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      inboundEventId: inboundEvent.id,
      ...result,
    };
    const receipt = sanitizeWhatsappInboundReceipt(response);
    await this.inboundGateway.complete(ingress.claim, result.processingStatus, receipt, result.errorMessage ?? null);
    return options.trustedInternalValidation || process.env.NODE_ENV === 'test' ? response : receipt;
    } catch (error) {
      await this.inboundGateway.complete(
        ingress.claim,
        'FAILED',
        { processingStatus: 'FAILED' },
        this.sanitizeProviderError(error),
      );
      throw error;
    }
  }

  async pauseConversation(conversationId: string, actorId: string) {
    await this.handoffService.transition({ conversationId, actorId, target: 'SOFIA_PAUSED', reasonCode: 'OPERATOR_PAUSE' });
    return this.loadConversation(conversationId);
  }

  async resumeConversation(conversationId: string, actorId: string) {
    await this.handoffService.transition({ conversationId, actorId, target: 'SOFIA_ACTIVE', reasonCode: 'OPERATOR_RESUME' });
    return this.loadConversation(conversationId);
  }

  async takeOverConversation(conversationId: string, actorId: string) {
    await this.handoffService.transition({ conversationId, actorId, target: 'HUMAN_TAKEN', reasonCode: 'OPERATOR_TAKEOVER', assignedToUserId: actorId });
    return this.loadConversation(conversationId);
  }

  async releaseConversation(conversationId: string, _actorId: string) {
    await this.handoffService.transition({ conversationId, actorId: _actorId, target: 'SOFIA_ACTIVE', reasonCode: 'OPERATOR_RELEASE' });
    return this.loadConversation(conversationId);
  }

  async approveSend(outboundId: string, actorId: string) {
    void outboundId;
    void actorId;
    throw new ForbiddenException({ code: 'SOFIA_SECURE_COMMAND_REQUIRED', sent: false });
  }

  async cancelOutbound(outboundId: string, actorId: string) {
    const outbound = await this.conversations.cancelOutbound(outboundId, actorId);
    if (!outbound) throw new NotFoundException('No se encontró el mensaje saliente Sofía.');
    return outbound;
  }

  async retryOutbound(outboundId: string) {
    void outboundId;
    throw new ForbiddenException({ code: 'SOFIA_SECURE_COMMAND_REQUIRED', sent: false });
  }

  private async handleInboundMode(input: {
    mode: WhatsappMode;
    providerName: WhatsappProviderName;
    parsed: ParsedWhatsappInbound;
    conversationId: string;
    inboundMessageId: string;
    accountId: string;
    headers: HeaderMap;
    eventHash: string;
    claim: WhatsappInboundClaimContext;
  }) {
    const {
      mode,
      providerName,
      parsed,
      conversationId,
      inboundMessageId,
      accountId,
      headers,
      eventHash,
      claim,
    } = input;
    if (this.isAbandonedInboundRecovery(claim.recoveryCheckpoint)) {
      return {
        processingStatus: 'HUMAN_REQUIRED',
        outbound: null,
        sofiaResult: null,
        errorMessage: 'WHATSAPP_INBOUND_WORKER_DIED',
      };
    }
    const recoveredCheckpoint = parseWhatsappInboundDurableCheckpoint(
      claim.recoveryCheckpoint,
      { eventHash, conversationId, inboundMessageId, mode, provider: providerName },
    );
    if (recoveredCheckpoint?.kind === 'SOFIA_CONVERSATION_RESULT_V1') {
      return this.applyInboundConversationCheckpoint({
        checkpoint: recoveredCheckpoint,
        claim,
        accountId,
        sofiaResult: null,
      });
    }
    if (recoveredCheckpoint?.kind === 'SOFIA_CONVERSATION_STARTED_V1') {
      return this.failClosedRecoveredConversation({
        claim,
        checkpoint: recoveredCheckpoint,
      });
    }

    const automationGate = await this.runtimeSafetyService.evaluate('INBOUND_ANALYSIS');
    if (!automationGate.allowed) {
      await this.runtimeSafetyService.recordBlocked('INBOUND_ANALYSIS', {
        phone: parsed.phone,
        reason: automationGate.reason,
        blockers: automationGate.blockers,
        idempotencyKey: inboundMessageId,
      });
      return {
        processingStatus: automationGate.reason,
        outbound: null,
        sofiaResult: null,
        errorMessage: automationGate.reason,
      };
    }
    if (mode === 'disabled') {
      return { processingStatus: 'DISABLED_STORED', outbound: null, sofiaResult: null, errorMessage: null };
    }

    const conversation = await this.ensureConversation(conversationId);
    const policy = await this.messagePolicy.inbound(conversationId, conversation.customerId);
    if (!policy.allowed) {
      return { processingStatus: policy.reasonCode, outbound: null, sofiaResult: null, errorMessage: policy.reasonCode };
    }
    if (!conversation.sofiaEnabled || PAUSED_STATUSES.includes(conversation.status) || conversation.humanStatus !== 'SOFIA_ACTIVE') {
      return { processingStatus: 'SOFIA_PAUSED', outbound: null, sofiaResult: null, errorMessage: null };
    }

    const actorId = await this.systemActorId();
    const agentInputText = parsed.transcript || parsed.body || '';
    let sofiaResult: Awaited<ReturnType<SofiaAgentService['processSandboxMessage']>>;

    const unprocessedMedia = ['AUDIO', 'IMAGE', 'DOCUMENT'].includes(parsed.messageType);
    if (unprocessedMedia) {
      const isAudio = parsed.messageType === 'AUDIO';
      const mediaLabel = isAudio ? 'audio' : parsed.messageType === 'DOCUMENT' ? 'documento' : 'imagen';
      const responseText = isAudio
        ? 'Recibí tu audio, pero necesito que me confirmes el pedido por texto para evitar errores.'
        : `Recibí tu ${mediaLabel}, pero no puedo interpretarlo de forma confiable. Escríbeme qué necesitas y un operador podrá revisarlo.`;
      sofiaResult = {
        conversationId,
        detectedIntent: 'UNKNOWN',
        confidence: 0.2,
        extractedItems: [],
        currentItems: [],
        missingFields: ['textConfirmation'],
        suggestedUpsell: null,
        mediaSuggestion: null,
        featuredOffers: [],
        commercialCatalog: [],
        matchedCatalogItem: null,
        matchedFeaturedOffer: null,
        promptVersion: 'SOFIA_MASTER_PROMPT_V2',
        memory: {
          customer: {
            id: 'media-fallback',
            phoneMasked: this.maskPhone(parsed.phone),
            displayName: parsed.customerName ?? null,
            lastKnownAddress: null,
            preferredPaymentMethod: null,
            lastOrderSummary: null,
            preferences: null,
            memorySummary: null,
            consentState: 'UNKNOWN',
            lastInteractionAt: null,
          },
          conversation: {
            id: 'media-fallback',
            conversationId,
            currentIntent: 'UNKNOWN',
            currentOrderIntent: null,
            missingFields: ['textConfirmation'],
            lastProductDiscussed: null,
            memorySummary: null,
            updatedAt: new Date().toISOString(),
          },
          repeatLastOrder: null,
        },
        autoSafeDecision: {
          status: 'HUMAN_REQUIRED',
          riskLevel: 'HIGH',
          approved: false,
          shouldSend: false,
          shouldCreateOutbox: false,
          shouldRequireHuman: true,
          reasonCodes: ['LOW_CONFIDENCE'],
          blockingReasons: [`${mediaLabel} sin texto utilizable requiere revisión humana.`],
          warnings: ['No se ejecutó IA multimodal ni una acción operativa.'],
          correctedReply: null,
          finalReply: responseText,
          requiredHumanAction: 'Solicitar confirmación por texto antes de avanzar.',
          auditJson: {
            source: `${parsed.messageType}_WITHOUT_TEXT_SAFE_FALLBACK`,
            noWhatsappRealSent: true,
          },
          createdAt: new Date().toISOString(),
        },
        nextAction: 'ASK_TEXT_CONFIRMATION',
        responseText,
        shouldCreateDraft: false,
        shouldConfirmOrder: false,
        shouldHandoff: true,
        paymentLinkUrl: null,
        draft: null,
        deliveryOrder: null,
        businessStatus: { isOpen: true, timezone: 'America/Bogota', schedule: '5:00 p.m. a 12:00 a.m.' },
        safeguards: {
          noWhatsappReal: true,
          noHermesReal: true,
          deepSeekBackendOnly: true,
          aiCannotOperateHermes: true,
          aiCannotMarkPaid: true,
          noRealPayments: true,
          sandboxOperationalIsolation: false,
          productiveActionBlocked: `${parsed.messageType}_WITHOUT_TEXT`,
        },
        aiProvider: {
          provider: 'rules',
          mode: 'disabled',
          fallbackUsed: false,
          confidence: 0.2,
          safetyFlags: [],
          forbiddenClaimsDetected: [],
          diagnostics: [`${parsed.messageType}_WITHOUT_TEXT_SAFE_FALLBACK`],
        },
      };
    } else {
      await this.inboundGateway.checkpoint(
        claim,
        createWhatsappInboundConversationStartedCheckpoint({
          eventHash,
          conversationId,
          inboundMessageId,
          mode,
          provider: providerName,
        }),
      );
      sofiaResult = await this.withInboundAgentLease(claim, () =>
        this.sofiaAgentService.processInboundMessage(
          {
            conversationId,
            phone: parsed.phone,
            customerName: parsed.customerName ?? undefined,
            message: agentInputText,
            messageType: parsed.messageType === 'AUDIO' ? 'AUDIO_TRANSCRIPT' : 'TEXT',
            transcriptConfidence: parsed.messageType === 'AUDIO' ? 0.75 : undefined,
            sandboxNow: typeof parsed.rawPayload.sandboxNow === 'string' ? parsed.rawPayload.sandboxNow : undefined,
          },
          actorId,
          {
            recordInbound: false,
            recordOutbound: false,
            headers,
            sourceEventId: claim.inboundEventId,
          },
        ),
      );
    }

    const responseText = sofiaResult.responseText.slice(0, 4_000);
    const mediaUrl = this.isSofiaFeaturedOfferMedia(sofiaResult.mediaSuggestion?.imageUrl)
      ? (sofiaResult.mediaSuggestion?.imageUrl ?? null)
      : null;
    const checkpoint = createWhatsappInboundConversationCheckpoint({
      eventHash,
      conversationId,
      inboundMessageId,
      mode,
      provider: providerName,
      responseText,
      confidence: sofiaResult.confidence,
      businessOpen: sofiaResult.businessStatus.isOpen,
      shouldHandoff: sofiaResult.shouldHandoff,
      handoffApplied: false,
      mediaUrl,
      outboundStatus: responseText.trim()
        ? this.resolveOutboundStatus(mode, sofiaResult.confidence, sofiaResult.businessStatus.isOpen, headers)
        : null,
    });
    await this.inboundGateway.checkpoint(claim, checkpoint);
    this.afterInboundConversationCheckpoint();

    return this.applyInboundConversationCheckpoint({
      checkpoint,
      claim,
      accountId,
      sofiaResult,
    });
  }

  private isAbandonedInboundRecovery(value: unknown): boolean {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && 'kind' in value
      && value.kind === 'WHATSAPP_INBOUND_ABANDONED_V1',
    );
  }

  private async failClosedRecoveredConversation(input: {
    claim: WhatsappInboundClaimContext;
    checkpoint: Readonly<{
      eventHash: string;
      conversationId: string;
      inboundMessageId: string;
      mode: WhatsappMode;
      provider: WhatsappProviderName;
    }>;
  }) {
    await this.ensureInboundHumanHandoff(
      input.checkpoint.conversationId,
      'SOFIA_INBOUND_PROCESSING_OUTCOME_UNKNOWN',
    );
    const terminalCheckpoint = createWhatsappInboundConversationCheckpoint({
      ...input.checkpoint,
      responseText: '',
      confidence: 0,
      businessOpen: false,
      shouldHandoff: true,
      handoffApplied: true,
      mediaUrl: null,
      outboundStatus: null,
    });
    await this.inboundGateway.checkpoint(input.claim, terminalCheckpoint);
    return {
      processingStatus: 'HUMAN_REQUIRED',
      outbound: null,
      sofiaResult: null,
      errorMessage: 'WHATSAPP_INBOUND_PROCESSING_OUTCOME_UNKNOWN',
    };
  }

  private async withInboundAgentLease<T>(
    claim: WhatsappInboundClaimContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.inboundGateway.renew(claim);
    let heartbeatInFlight: Promise<void> | null = null;
    let leaseFailure: unknown = null;
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight || leaseFailure) return;
      heartbeatInFlight = this.inboundGateway.renew(claim)
        .then(() => undefined)
        .catch((error: unknown) => {
          leaseFailure = error;
        })
        .finally(() => {
          heartbeatInFlight = null;
        });
    }, INBOUND_AGENT_HEARTBEAT_MS);
    heartbeat.unref();

    try {
      // The agent's external boundaries own their cancellable timeouts. Releasing this
      // lease while an uncancellable promise still runs would permit late mutations.
      const result = await operation();
      if (heartbeatInFlight) await heartbeatInFlight;
      if (leaseFailure) throw leaseFailure;
      await this.inboundGateway.renew(claim);
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async applyInboundConversationCheckpoint(input: {
    checkpoint: WhatsappInboundConversationCheckpoint;
    claim: WhatsappInboundClaimContext;
    accountId: string;
    sofiaResult: Awaited<ReturnType<SofiaAgentService['processSandboxMessage']>> | null;
  }) {
    let { checkpoint } = input;
    if (checkpoint.shouldHandoff && !checkpoint.handoffApplied) {
      await this.ensureInboundHumanHandoff(checkpoint.conversationId, 'SOFIA_SAFE_HANDOFF');
      checkpoint = createWhatsappInboundConversationCheckpoint({
        ...checkpoint,
        handoffApplied: true,
      });
      await this.inboundGateway.checkpoint(input.claim, checkpoint);
    }

    const outbound = await this.createOutboundForMode({
      mode: checkpoint.mode,
      providerName: checkpoint.provider,
      conversationId: checkpoint.conversationId,
      inboundMessageId: checkpoint.inboundMessageId,
      responseText: checkpoint.responseText,
      mediaUrl: checkpoint.mediaUrl,
      confidence: checkpoint.confidence,
      isOpen: checkpoint.businessOpen,
      accountId: input.accountId,
      statusOverride: checkpoint.outboundStatus,
    });

    return {
      processingStatus: outbound?.status === 'APPROVAL_PENDING' || outbound?.status === 'SUGGESTED' ? 'SUGGESTED' : 'PROCESSED',
      outbound,
      sofiaResult: input.sofiaResult,
      errorMessage: null,
    };
  }

  private async ensureInboundHumanHandoff(conversationId: string, reasonCode: string) {
    const current = await this.handoffService.decision(conversationId);
    if (['HUMAN_REQUIRED', 'HUMAN_TAKEN', 'SOFIA_PAUSED'].includes(current.state)) return;
    if (current.state !== 'SOFIA_ACTIVE') throw new Error('WHATSAPP_HANDOFF_STATE_CONFLICT');
    await this.handoffService.transition({
      conversationId,
      actorId: await this.systemActorId(),
      target: 'HUMAN_REQUIRED',
      reasonCode,
    });
  }

  private afterInboundConversationCheckpoint() {
    // Deliberate fault-injection seam: production execution is a no-op.
  }

  private resolveOutboundStatus(
    mode: WhatsappMode,
    confidence: number,
    isOpen: boolean,
    headers?: HeaderMap,
  ) {
    if (mode === 'receive_only') return 'SUGGESTED';
    if (mode === 'supervised') return 'APPROVAL_PENDING';
    if (mode === 'mock') return 'QUEUED';
    if (mode === 'auto') {
      return this.providerFactory.isAutoReplyAllowed(confidence, isOpen, headers)
        ? 'QUEUED'
        : 'APPROVAL_PENDING';
    }
    return 'APPROVAL_PENDING';
  }

  private async createOutboundForMode(input: {
    mode: WhatsappMode;
    providerName: WhatsappProviderName;
    conversationId: string;
    inboundMessageId: string;
    responseText: string;
    mediaUrl?: string | null;
    confidence: number;
    isOpen: boolean;
    accountId: string;
    headers?: HeaderMap;
    statusOverride?: string | null;
  }) {
    const {
      mode,
      providerName,
      conversationId,
      inboundMessageId,
      responseText,
      mediaUrl,
      confidence,
      isOpen,
      accountId,
      headers,
      statusOverride,
    } = input;
    if (!responseText.trim()) return null;
    const responseHash = this.sha256(`${responseText}|${mediaUrl ?? ''}`);
    const idempotencyKey = `outbound:${conversationId}:${inboundMessageId}:${responseHash}`;
    const existing = await this.conversations.findOutboundByIdempotency(idempotencyKey);
    if (existing) return existing;

    const status = statusOverride ?? this.resolveOutboundStatus(mode, confidence, isOpen, headers);

    const outbound = await this.conversations.createOutbound({
        conversationId,
        inboundMessageId,
        provider: providerName,
        localMessageId: `local-${this.sha256(idempotencyKey).slice(0, 24)}`,
        body: responseText,
        mediaUrl: this.isSofiaFeaturedOfferMedia(mediaUrl) ? (mediaUrl ?? null) : null,
        status,
        idempotencyKey,
        accountId,
        recipientIdentityHash: this.providerHealth.identityHash(
          (await this.ensureConversation(conversationId)).phone,
        ),
    });

    return outbound;
  }

  private async getOrCreateWhatsappConversation(
    parsed: ParsedWhatsappInbound,
    mode: WhatsappMode,
    providerName: WhatsappProviderName,
    source: SofiaOrderSource,
  ) {
    const crmCustomer = source === SofiaOrderSource.MOCK_ADMIN ? null : await this.resolveCrmCustomer(parsed);
    const existing = await this.conversations.findActiveConversation(parsed.phone, source);
    const data = {
      customerName: parsed.customerName || existing?.customerName || null,
      provider: providerName,
      providerConversationId: parsed.providerConversationId ?? existing?.providerConversationId ?? null,
      mode,
      lastMessagePreview: this.safeInboundPreview(parsed),
      customerId: crmCustomer?.id ?? existing?.customerId ?? undefined,
    };
    if (existing) {
      return this.conversations.updateConversation(existing.id, data);
    }
    return this.conversations.createConversation({
        phone: parsed.phone,
        customerName: parsed.customerName ?? null,
        provider: providerName,
        providerConversationId: parsed.providerConversationId ?? null,
        mode,
        source,
        customerId: crmCustomer?.id ?? null,
        lastMessagePreview: this.safeInboundPreview(parsed),
    });
  }

  private async resolveCrmCustomer(parsed: ParsedWhatsappInbound) {
    try {
      const actorId = await this.systemActorId();
      return await this.crmService.resolveOrCreateByPhone(
        { phone: parsed.phone, displayName: parsed.customerName ?? undefined },
        TrustedCrmCustomerResolutionCapability.issue(actorId, 'WHATSAPP_INBOUND'),
      );
    } catch (error) {
      this.logger.warn(`CRM identity link unavailable: ${this.sanitizeProviderError(error)}`);
      return null;
    }
  }

  private async ensureConversation(conversationId: string) {
    const conversation = await this.conversations.findConversation(conversationId);
    if (!conversation) throw new NotFoundException('No se encontró la conversación Sofía/WhatsApp.');
    return conversation;
  }

  private loadConversation(conversationId: string) {
    return this.conversations.loadConversation(conversationId);
  }

  private sanitizeProviderError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Error enviando WhatsApp.';
    return message
      .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
      .replace(/[A-Za-z0-9_-]{24,}/g, '[REDACTED]')
      .slice(0, 240);
  }

  private maskPhone(value: string) {
    const digits = value.replace(/\D/g, '');
    return `${'*'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
  }

  private async systemActorId() {
    const actorId = await this.conversations.findSystemActorId();
    if (!actorId) throw new ForbiddenException('No hay usuario operativo activo para registrar acciones Sofía.');
    return actorId;
  }

  private hashPayload(parsed: ParsedWhatsappInbound, suffix = '') {
    return this.sha256(
      [
        parsed.provider,
        parsed.providerEventId ?? '',
        parsed.providerMessageId,
        parsed.phone,
        parsed.timestamp?.toISOString() ?? '',
        parsed.body ?? '',
        parsed.transcript ?? '',
        parsed.mediaUrl ?? '',
        suffix,
      ].join('|'),
    );
  }

  private safeInboundPreview(parsed: ParsedWhatsappInbound) {
    const text = parsed.body || parsed.transcript;
    if (text?.trim()) return text.trim().slice(0, 180);
    if (parsed.messageType === 'AUDIO') return '[Nota de voz recibida]';
    if (parsed.messageType === 'IMAGE') return '[Imagen recibida]';
    return '[Mensaje sin texto]';
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private isSofiaFeaturedOfferMedia(mediaUrl?: string | null) {
    if (!mediaUrl) return false;
    return [
      '/uploads/sofia-offers/maxi-family.webp',
      '/uploads/sofia-offers/2x1-hamburguesas.webp',
      '/uploads/sofia-offers/doble-todo.webp',
      '/uploads/sofia-offers/hamburguesa-sencilla.webp',
    ].includes(mediaUrl);
  }

}
