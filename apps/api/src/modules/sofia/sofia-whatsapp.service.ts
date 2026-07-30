import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  Prisma,
  SofiaOrderSource,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaCrmService } from './crm/sofia-crm.service';
import { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { WhatsappProviderFactory } from './whatsapp/whatsapp-provider.factory';
import { ParsedWhatsappInbound, WhatsappMode, WhatsappProviderName } from './whatsapp/whatsapp-provider.adapter';

type HeaderMap = Record<string, string | string[] | undefined>;

const PAUSED_STATUSES: WhatsappConversationStatus[] = [
  WhatsappConversationStatus.HUMAN_REQUIRED,
  WhatsappConversationStatus.HUMAN_TAKEN,
  WhatsappConversationStatus.SOFIA_PAUSED,
];

@Injectable()
export class SofiaWhatsappService {
  private readonly logger = new Logger(SofiaWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: WhatsappProviderFactory,
    private readonly sofiaAgentService: SofiaAgentService,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
    private readonly crmService: SofiaCrmService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  getStatus() {
    return this.providerFactory.getStatus();
  }

  async processInboundWebhook(
    providerParam: string,
    rawPayload: Record<string, unknown>,
    headers: HeaderMap,
    options: { trustedInternalValidation?: boolean; trustedBaileysTransport?: boolean } = {},
  ) {
    const mode = this.providerFactory.resolveMode(headers);
    const providerName = this.providerFactory.resolveProviderName(providerParam, headers);
    const provider = this.providerFactory.getProvider(providerName);
    const parsed = provider.parseInboundWebhook(rawPayload, headers);
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

    if (effectiveProvider === 'hermes' && !provider.verifyWebhookSignature(rawPayload, headers)) {
      await this.recordInboundEvent({
        parsed,
        providerName: effectiveProvider,
        eventHash: this.hashPayload(parsed, 'signature-invalid'),
        processingStatus: 'SIGNATURE_INVALID',
        errorMessage: 'Firma Hermes inválida.',
      });
      throw new UnauthorizedException('Webhook WhatsApp no autorizado.');
    }

    if (!parsed.phone) {
      throw new BadRequestException('El webhook WhatsApp no incluye teléfono válido.');
    }

    const eventHash = this.hashPayload(parsed);
    const duplicated = await this.findDuplicateInbound(parsed, eventHash);
    if (duplicated) {
      await this.safeMarkDuplicate(parsed, effectiveProvider, eventHash);
      await this.runtimeSafetyService.recordBlocked('DUPLICATE_INBOUND', {
        phone: parsed.phone,
        reason: 'DUPLICATE_IGNORED',
        idempotencyKey: eventHash,
      });
      return {
        duplicate: true,
        mode,
        provider: effectiveProvider,
        processingStatus: 'DUPLICATE_IGNORED',
        inboundEventId: duplicated.id,
      };
    }

    const inboundEvent = await this.recordInboundEvent({
      parsed,
      providerName: effectiveProvider,
      eventHash,
      processingStatus: 'RECEIVED',
      errorMessage: null,
    }).catch(async (error) => {
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.findDuplicateInbound(parsed, eventHash);
        if (existing) return existing;
      }
      throw error;
    });
    if (inboundEvent.processingStatus !== 'RECEIVED') {
      return {
        duplicate: true,
        mode,
        provider: effectiveProvider,
        processingStatus: 'DUPLICATE_IGNORED',
        inboundEventId: inboundEvent.id,
      };
    }

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
      const inboundMessage = await this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.INBOUND,
          type: parsed.messageType as WhatsappMessageType,
          provider: effectiveProvider,
          providerMessageId: parsed.providerMessageId,
          providerTimestamp: parsed.timestamp,
          body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
          // Sofia does not fetch inbound media. Persisting provider URLs can leak
          // short-lived credentials, so only the media type is retained.
          mediaUrl: null,
          mediaMimeType: parsed.mediaMimeType ?? null,
          transcript: parsed.transcript ?? null,
          rawPayload: this.privacyService.sanitizeJson(parsed.rawPayload) as Prisma.InputJsonValue,
          status: 'PILOT_NOT_ALLOWED',
          idempotencyKey: `inbound:${eventHash}`,
          errorMessage: 'ALLOWLIST_REQUIRED',
        },
      }).catch(async (error) => {
        if (!this.isUniqueConstraintError(error)) throw error;
        const existing = await this.prisma.whatsappMessage.findUnique({ where: { idempotencyKey: `inbound:${eventHash}` } });
        if (!existing) throw error;
        return existing;
      });

      await this.prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          status: WhatsappConversationStatus.HUMAN_REQUIRED,
          humanStatus: 'PILOT_NOT_ALLOWED',
          sofiaEnabled: false,
          riskFlags: {
            reason: 'ALLOWLIST_REQUIRED',
            receiveOnly: true,
            noWhatsappRealSent: true,
          } as Prisma.InputJsonValue,
        },
      });
      await this.prisma.whatsappInboundEvent.update({
        where: { id: inboundEvent.id },
        data: {
          processedAt: new Date(),
          processingStatus: 'ALLOWLIST_REQUIRED',
          errorMessage: 'Número fuera de allowlist piloto QR.',
        },
      });
      await this.runtimeSafetyService.recordBlocked('ALLOWLIST', {
        phone: parsed.phone,
        reason: allowlist.reason,
        idempotencyKey: eventHash,
      });

      return {
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
    }
    const conversation = await this.getOrCreateWhatsappConversation(
      parsed,
      mode,
      effectiveProvider,
      options.trustedInternalValidation ? SofiaOrderSource.MOCK_ADMIN : SofiaOrderSource.WHATSAPP,
    );
    const inboundMessage = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsappMessageDirection.INBOUND,
        type: parsed.messageType as WhatsappMessageType,
        provider: effectiveProvider,
        providerMessageId: parsed.providerMessageId,
        providerTimestamp: parsed.timestamp,
        body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
        mediaUrl: null,
        mediaMimeType: parsed.mediaMimeType ?? null,
        transcript: parsed.transcript ?? null,
        rawPayload: this.privacyService.sanitizeJson(parsed.rawPayload) as Prisma.InputJsonValue,
        status: 'RECEIVED',
        idempotencyKey: `inbound:${eventHash}`,
      },
    }).catch(async (error) => {
      if (!this.isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.whatsappMessage.findUnique({ where: { idempotencyKey: `inbound:${eventHash}` } });
      if (!existing) throw error;
      return existing;
    });

    const result = await this.handleInboundMode({
      mode,
      providerName: effectiveProvider,
      parsed,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      headers,
    });

    await this.prisma.whatsappInboundEvent.update({
      where: { id: inboundEvent.id },
      data: { processedAt: new Date(), processingStatus: result.processingStatus, errorMessage: result.errorMessage ?? null },
    });

    return {
      mode,
      provider: effectiveProvider,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      inboundEventId: inboundEvent.id,
      ...result,
    };
  }

  async pauseConversation(conversationId: string, _actorId: string) {
    await this.ensureConversation(conversationId);
    return this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { status: WhatsappConversationStatus.SOFIA_PAUSED, humanStatus: 'SOFIA_PAUSED', sofiaEnabled: false },
      include: this.conversationInclude(),
    });
  }

  async resumeConversation(conversationId: string, _actorId: string) {
    await this.ensureConversation(conversationId);
    return this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { status: WhatsappConversationStatus.ACTIVE, humanStatus: 'SOFIA_ACTIVE', sofiaEnabled: true },
      include: this.conversationInclude(),
    });
  }

  async takeOverConversation(conversationId: string, actorId: string) {
    await this.ensureConversation(conversationId);
    return this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: {
        status: WhatsappConversationStatus.HUMAN_TAKEN,
        humanStatus: 'HUMAN_TAKEN',
        sofiaEnabled: false,
        assignedToUserId: actorId,
        lastHumanTakeoverAt: new Date(),
      },
      include: this.conversationInclude(),
    });
  }

  async releaseConversation(conversationId: string, _actorId: string) {
    await this.ensureConversation(conversationId);
    return this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: {
        status: WhatsappConversationStatus.ACTIVE,
        humanStatus: 'SOFIA_ACTIVE',
        sofiaEnabled: true,
        assignedToUserId: null,
      },
      include: this.conversationInclude(),
    });
  }

  async approveSend(outboundId: string, actorId: string) {
    const outbound = await this.prisma.whatsappOutboundMessage.findUnique({
      where: { id: outboundId },
      include: { conversation: true },
    });
    if (!outbound) throw new NotFoundException('No se encontró el mensaje saliente Sofía.');
    if (!['APPROVAL_PENDING', 'SUGGESTED', 'FAILED', 'RETRYING', 'QUEUED'].includes(outbound.status)) {
      return outbound;
    }
    const providerName = (outbound.provider || 'mock') as WhatsappProviderName;
    const gate = await this.runtimeSafetyService.evaluate('OUTBOUND_SEND', { simulated: providerName === 'mock' });
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('OUTBOUND_SEND', {
        actorId,
        phone: outbound.conversation.phone,
        reason: gate.reason,
        blockers: gate.blockers,
        idempotencyKey: outbound.idempotencyKey,
      });
      throw new ForbiddenException({ status: 'BLOCKED', reason: gate.reason, blockers: gate.blockers, sent: false });
    }
    const claim = await this.prisma.whatsappOutboundMessage.updateMany({
      where: { id: outbound.id, status: outbound.status },
      data: { status: 'SENDING', approvedById: actorId, approvedAt: new Date() },
    });
    if (claim.count !== 1) {
      return this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outbound.id } });
    }
    const provider = this.providerFactory.getProvider(providerName);
    if (provider.provider === 'none') throw new ForbiddenException('WhatsApp provider no configurado para enviar.');
    const sent = outbound.mediaUrl
      ? await provider.sendMediaMessage({
          to: outbound.conversation.phone,
          body: outbound.body,
          mediaUrl: outbound.mediaUrl,
          idempotencyKey: outbound.idempotencyKey,
        })
      : await provider.sendTextMessage({
          to: outbound.conversation.phone,
          body: outbound.body,
          idempotencyKey: outbound.idempotencyKey,
        });
    return this.prisma.whatsappOutboundMessage.update({
      where: { id: outbound.id },
      data: {
        status: sent.status,
        providerMessageId: sent.providerMessageId,
        attempts: { increment: 1 },
        lastError: sent.errorMessage ?? null,
        sentAt: sent.status === 'SENT' ? new Date() : null,
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });
  }

  async cancelOutbound(outboundId: string, actorId: string) {
    const outbound = await this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outboundId } });
    if (!outbound) throw new NotFoundException('No se encontró el mensaje saliente Sofía.');
    return this.prisma.whatsappOutboundMessage.update({
      where: { id: outboundId },
      data: { status: 'CANCELLED', approvedById: actorId, approvedAt: new Date() },
    });
  }

  async retryOutbound(outboundId: string) {
    const outbound = await this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outboundId }, include: { conversation: true } });
    if (!outbound) throw new NotFoundException('No se encontró el mensaje saliente Sofía.');
    if (!['QUEUED', 'RETRYING', 'FAILED'].includes(outbound.status)) return outbound;
    const gate = await this.runtimeSafetyService.evaluate('OUTBOUND_SEND', { simulated: outbound.provider === 'mock' });
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('OUTBOUND_SEND', {
        phone: outbound.conversation.phone,
        reason: gate.reason,
        blockers: gate.blockers,
        idempotencyKey: outbound.idempotencyKey,
      });
      throw new ForbiddenException({ status: 'BLOCKED', reason: gate.reason, blockers: gate.blockers, sent: false });
    }
    return this.sendOrRetryOutbound(outbound.id);
  }

  private async handleInboundMode(input: {
    mode: WhatsappMode;
    providerName: WhatsappProviderName;
    parsed: ParsedWhatsappInbound;
    conversationId: string;
    inboundMessageId: string;
    headers: HeaderMap;
  }) {
    const { mode, providerName, parsed, conversationId, inboundMessageId, headers } = input;
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
    if (!conversation.sofiaEnabled || PAUSED_STATUSES.includes(conversation.status) || conversation.humanStatus !== 'SOFIA_ACTIVE') {
      return { processingStatus: 'SOFIA_PAUSED', outbound: null, sofiaResult: null, errorMessage: null };
    }

    const actorId = await this.systemActorId();
    const agentInputText = parsed.transcript || parsed.body || '';
    let sofiaResult: Awaited<ReturnType<SofiaAgentService['processSandboxMessage']>>;

    const unsupportedMediaWithoutText =
      ['AUDIO', 'IMAGE'].includes(parsed.messageType) && !agentInputText.trim();
    if (unsupportedMediaWithoutText) {
      const isAudio = parsed.messageType === 'AUDIO';
      const mediaLabel = isAudio ? 'audio' : 'imagen';
      const responseText = isAudio
        ? 'Recibí tu audio, pero necesito que me confirmes el pedido por texto para evitar errores.'
        : 'Recibí tu imagen, pero no puedo interpretarla de forma confiable. Escríbeme qué necesitas y un operador podrá revisarla.';
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
      sofiaResult = await this.sofiaAgentService.processInboundMessage(
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
        { recordInbound: false, recordOutbound: false, headers },
      );
    }

    if (sofiaResult.shouldHandoff) {
      await this.prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { status: WhatsappConversationStatus.HUMAN_REQUIRED, humanStatus: 'HUMAN_REQUIRED', sofiaEnabled: false },
      });
    }

    const outbound = await this.createOutboundForMode({
      mode,
      providerName,
      conversationId,
      inboundMessageId,
      responseText: sofiaResult.responseText,
      mediaUrl: sofiaResult.mediaSuggestion?.imageUrl ?? null,
      confidence: sofiaResult.confidence,
      isOpen: sofiaResult.businessStatus.isOpen,
      headers,
    });

    return {
      processingStatus: outbound?.status === 'APPROVAL_PENDING' || outbound?.status === 'SUGGESTED' ? 'SUGGESTED' : 'PROCESSED',
      outbound,
      sofiaResult,
      errorMessage: null,
    };
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
    headers?: HeaderMap;
  }) {
    const { mode, providerName, conversationId, inboundMessageId, responseText, mediaUrl, confidence, isOpen, headers } = input;
    if (!responseText.trim()) return null;
    const responseHash = this.sha256(`${responseText}|${mediaUrl ?? ''}`);
    const idempotencyKey = `outbound:${conversationId}:${inboundMessageId}:${responseHash}`;
    const existing = await this.prisma.whatsappOutboundMessage.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;

    let status = 'APPROVAL_PENDING';
    if (mode === 'receive_only') status = 'SUGGESTED';
    if (mode === 'supervised') status = 'APPROVAL_PENDING';
    if (mode === 'mock') status = 'QUEUED';
    if (mode === 'auto') {
      status = this.providerFactory.isAutoReplyAllowed(confidence, isOpen, headers) ? 'QUEUED' : 'APPROVAL_PENDING';
    }

    const outbound = await this.prisma.whatsappOutboundMessage.create({
      data: {
        conversationId,
        inboundMessageId,
        provider: providerName,
        localMessageId: `local-${this.sha256(idempotencyKey).slice(0, 24)}`,
        body: responseText,
        mediaUrl: this.isSofiaFeaturedOfferMedia(mediaUrl) ? mediaUrl : null,
        status,
        idempotencyKey,
      },
    });

    if (status !== 'QUEUED') return outbound;
    return this.sendOrRetryOutbound(outbound.id);
  }

  private async sendOrRetryOutbound(outboundId: string) {
    const outbound = await this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outboundId }, include: { conversation: true } });
    if (!outbound) throw new NotFoundException('No se encontró el mensaje saliente Sofía.');
    const gate = await this.runtimeSafetyService.evaluate('OUTBOUND_SEND', { simulated: outbound.provider === 'mock' });
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('OUTBOUND_SEND', {
        phone: outbound.conversation.phone,
        reason: gate.reason,
        blockers: gate.blockers,
        idempotencyKey: outbound.idempotencyKey,
      });
      return this.prisma.whatsappOutboundMessage.update({
        where: { id: outbound.id },
        data: { status: 'FAILED', lastError: gate.reason, nextRetryAt: null },
      });
    }
    const claim = await this.prisma.whatsappOutboundMessage.updateMany({
      where: { id: outbound.id, status: outbound.status },
      data: { status: 'SENDING', nextRetryAt: null },
    });
    if (claim.count !== 1) {
      return this.prisma.whatsappOutboundMessage.findUnique({ where: { id: outbound.id } });
    }
    const provider = this.providerFactory.getProvider((outbound.provider || 'mock') as WhatsappProviderName);
    if (provider.provider === 'none') {
      return this.prisma.whatsappOutboundMessage.update({
        where: { id: outbound.id },
        data: { status: 'FAILED', lastError: 'Provider no configurado.' },
      });
    }

    try {
      const result = outbound.mediaUrl
        ? await provider.sendMediaMessage({
            to: outbound.conversation.phone,
            body: outbound.body,
            mediaUrl: outbound.mediaUrl,
            idempotencyKey: outbound.idempotencyKey,
          })
        : await provider.sendTextMessage({
            to: outbound.conversation.phone,
            body: outbound.body,
            idempotencyKey: outbound.idempotencyKey,
          });
      return this.prisma.whatsappOutboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: result.status,
          providerMessageId: result.providerMessageId,
          attempts: { increment: 1 },
          lastError: result.errorMessage ?? null,
          sentAt: result.status === 'SENT' ? new Date() : null,
        },
      });
    } catch (error) {
      const attempts = outbound.attempts + 1;
      const exceeded = attempts >= this.providerFactory.maxRetries();
      if (exceeded) {
        await this.prisma.whatsappConversation.update({
          where: { id: outbound.conversationId },
          data: { status: WhatsappConversationStatus.HUMAN_REQUIRED, humanStatus: 'HUMAN_REQUIRED', sofiaEnabled: false },
        });
      }
      return this.prisma.whatsappOutboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: exceeded ? 'FAILED' : 'RETRYING',
          attempts,
          nextRetryAt: exceeded ? null : new Date(Date.now() + Math.min(60_000, attempts * 10_000)),
          lastError: this.sanitizeProviderError(error),
        },
      });
    }
  }

  private async getOrCreateWhatsappConversation(
    parsed: ParsedWhatsappInbound,
    mode: WhatsappMode,
    providerName: WhatsappProviderName,
    source: SofiaOrderSource,
  ) {
    const crmCustomer = source === SofiaOrderSource.MOCK_ADMIN ? null : await this.resolveCrmCustomer(parsed);
    const existing = await this.prisma.whatsappConversation.findFirst({
      where: { phone: parsed.phone, source, status: { not: WhatsappConversationStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
    });
    const data = {
      customerName: parsed.customerName || existing?.customerName || null,
      provider: providerName,
      providerConversationId: parsed.providerConversationId ?? existing?.providerConversationId ?? null,
      mode,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      lastMessagePreview: this.safeInboundPreview(parsed),
      unreadCount: { increment: 1 },
      customerId: crmCustomer?.id ?? existing?.customerId ?? undefined,
    };
    if (existing) {
      return this.prisma.whatsappConversation.update({ where: { id: existing.id }, data });
    }
    return this.prisma.whatsappConversation.create({
      data: {
        phone: parsed.phone,
        customerName: parsed.customerName ?? null,
        provider: providerName,
        providerConversationId: parsed.providerConversationId ?? null,
        mode,
        source,
        status: WhatsappConversationStatus.ACTIVE,
        humanStatus: 'SOFIA_ACTIVE',
        sofiaEnabled: true,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        unreadCount: 1,
        customerId: crmCustomer?.id ?? null,
        lastMessagePreview: this.safeInboundPreview(parsed),
      },
    });
  }

  private async resolveCrmCustomer(parsed: ParsedWhatsappInbound) {
    try {
      const actorId = await this.systemActorId();
      return await this.crmService.resolveOrCreateByPhone(
        { phone: parsed.phone, displayName: parsed.customerName ?? undefined },
        actorId,
      );
    } catch (error) {
      this.logger.warn(`CRM identity link unavailable: ${this.sanitizeProviderError(error)}`);
      return null;
    }
  }

  private async findDuplicateInbound(parsed: ParsedWhatsappInbound, eventHash: string) {
    return this.prisma.whatsappInboundEvent.findFirst({
      where: {
        provider: parsed.provider,
        OR: [
          parsed.providerEventId ? { providerEventId: parsed.providerEventId } : undefined,
          { providerMessageId: parsed.providerMessageId },
          { eventHash },
        ].filter(Boolean) as Prisma.WhatsappInboundEventWhereInput[],
      },
    });
  }

  private async safeMarkDuplicate(parsed: ParsedWhatsappInbound, providerName: WhatsappProviderName, eventHash: string) {
    const duplicateId = `duplicate:${providerName}:${eventHash}:${Date.now()}`;
    await this.prisma.whatsappInboundEvent.create({
      data: {
        provider: providerName,
        providerEventId: duplicateId,
        providerMessageId: `${parsed.providerMessageId}:duplicate:${Date.now()}`,
        phone: parsed.phone,
        eventHash: `${eventHash}:duplicate:${Date.now()}`,
        rawPayload: this.privacyService.sanitizeJson(parsed.rawPayload) as Prisma.InputJsonValue,
        processingStatus: 'DUPLICATE_IGNORED',
        processedAt: new Date(),
      },
    });
  }

  private async recordInboundEvent(input: {
    parsed: ParsedWhatsappInbound;
    providerName: WhatsappProviderName;
    eventHash: string;
    processingStatus: string;
    errorMessage: string | null;
  }) {
    return this.prisma.whatsappInboundEvent.create({
      data: {
        provider: input.providerName,
        providerEventId: input.parsed.providerEventId,
        providerMessageId: input.parsed.providerMessageId,
        phone: input.parsed.phone,
        eventHash: input.eventHash,
        rawPayload: this.privacyService.sanitizeJson(input.parsed.rawPayload) as Prisma.InputJsonValue,
        processingStatus: input.processingStatus,
        errorMessage: input.errorMessage,
        processedAt: input.processingStatus === 'RECEIVED' ? null : new Date(),
      },
    });
  }

  private async ensureConversation(conversationId: string) {
    const conversation = await this.prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('No se encontró la conversación Sofía/WhatsApp.');
    return conversation;
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
    const user = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        roles: { some: { role: { name: { in: ['admin', 'supervisor', 'cashier'] } } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException('No hay usuario operativo activo para registrar acciones Sofía.');
    return user.id;
  }

  private conversationInclude() {
    return {
      messages: { orderBy: { createdAt: 'asc' as const } },
      outboundMessages: { orderBy: { createdAt: 'asc' as const } },
      orderDrafts: { orderBy: { createdAt: 'desc' as const }, take: 10 },
      deliveryOrders: { orderBy: { createdAt: 'desc' as const }, take: 10 },
    };
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

  private isUniqueConstraintError(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
  }
}
