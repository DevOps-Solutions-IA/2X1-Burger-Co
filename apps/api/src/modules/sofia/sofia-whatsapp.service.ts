import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SofiaAgentService } from './sofia-agent.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: WhatsappProviderFactory,
    private readonly sofiaAgentService: SofiaAgentService,
    private readonly configService: ConfigService,
  ) {}

  getStatus() {
    return this.providerFactory.getStatus();
  }

  async processInboundWebhook(providerParam: string, rawPayload: Record<string, unknown>, headers: HeaderMap) {
    const mode = this.providerFactory.resolveMode(headers);
    const providerName = this.providerFactory.resolveProviderName(providerParam, headers);
    const provider = this.providerFactory.getProvider(providerName);
    const parsed = provider.parseInboundWebhook(rawPayload, headers);
    const effectiveProvider = provider.provider;

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

    if (effectiveProvider === 'qr_gateway' && !this.isQrPilotInboundAllowed(parsed)) {
      const conversation = await this.getOrCreateWhatsappConversation(parsed, 'receive_only', effectiveProvider);
      const inboundMessage = await this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.INBOUND,
          type: parsed.messageType as WhatsappMessageType,
          provider: effectiveProvider,
          providerMessageId: parsed.providerMessageId,
          providerTimestamp: parsed.timestamp,
          body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
          mediaUrl: parsed.mediaUrl ?? null,
          mediaMimeType: parsed.mediaMimeType ?? null,
          transcript: parsed.transcript ?? null,
          rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
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
    const conversation = await this.getOrCreateWhatsappConversation(parsed, mode, effectiveProvider);
    const inboundMessage = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsappMessageDirection.INBOUND,
        type: parsed.messageType as WhatsappMessageType,
        provider: effectiveProvider,
        providerMessageId: parsed.providerMessageId,
        providerTimestamp: parsed.timestamp,
        body: parsed.messageType === 'AUDIO' ? null : parsed.body ?? null,
        mediaUrl: parsed.mediaUrl ?? null,
        mediaMimeType: parsed.mediaMimeType ?? null,
        transcript: parsed.transcript ?? null,
        rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
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

  async pauseConversation(conversationId: string, actorId: string) {
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

    if (parsed.messageType === 'AUDIO' && !agentInputText.trim()) {
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
        promptVersion: 'SOFIA_MASTER_PROMPT_V1',
        memory: {
          customer: {
            id: 'audio-fallback',
            phoneNormalized: parsed.phone,
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
            id: 'audio-fallback',
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
          blockingReasons: ['Audio sin transcript requiere confirmación por texto.'],
          warnings: ['No WhatsApp real enviado desde fallback de audio.'],
          correctedReply: null,
          finalReply: 'Recibí tu audio, pero necesito que me confirmes el pedido por texto para evitar errores.',
          requiredHumanAction: 'Solicitar confirmación por texto antes de avanzar.',
          auditJson: { source: 'AUDIO_WITHOUT_TRANSCRIPT_SAFE_FALLBACK', noWhatsappRealSent: true },
          createdAt: new Date().toISOString(),
        },
        nextAction: 'ASK_TEXT_CONFIRMATION',
        responseText: 'Recibí tu audio, pero necesito que me confirmes el pedido por texto para evitar errores.',
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
        },
        aiProvider: {
          provider: 'rules',
          mode: 'disabled',
          fallbackUsed: false,
          confidence: 0.2,
          safetyFlags: [],
          forbiddenClaimsDetected: [],
          diagnostics: ['AUDIO_WITHOUT_TRANSCRIPT_SAFE_FALLBACK'],
        },
      };
    } else {
      sofiaResult = await this.sofiaAgentService.processSandboxMessage(
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
        { recordInbound: false, recordOutbound: false, source: 'WHATSAPP', headers },
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
          lastError: error instanceof Error ? error.message : 'Error enviando WhatsApp.',
        },
      });
    }
  }

  private async getOrCreateWhatsappConversation(parsed: ParsedWhatsappInbound, mode: WhatsappMode, providerName: WhatsappProviderName) {
    const existing = await this.prisma.whatsappConversation.findFirst({
      where: { phone: parsed.phone, status: { not: WhatsappConversationStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
    });
    const data = {
      customerName: parsed.customerName || existing?.customerName || null,
      provider: providerName,
      providerConversationId: parsed.providerConversationId ?? existing?.providerConversationId ?? null,
      mode,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      lastMessagePreview: (parsed.body || parsed.transcript || parsed.mediaUrl || '').slice(0, 180),
      unreadCount: { increment: 1 },
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
        source: 'WHATSAPP',
        status: WhatsappConversationStatus.ACTIVE,
        humanStatus: 'SOFIA_ACTIVE',
        sofiaEnabled: true,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        unreadCount: 1,
        lastMessagePreview: (parsed.body || parsed.transcript || parsed.mediaUrl || '').slice(0, 180),
      },
    });
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
        rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
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
        rawPayload: input.parsed.rawPayload as Prisma.InputJsonValue,
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

  private isQrPilotInboundAllowed(parsed: ParsedWhatsappInbound) {
    const summary = parsed.rawPayload.summary;
    const source = summary && typeof summary === 'object' && !Array.isArray(summary) ? String((summary as { source?: unknown }).source ?? '') : '';
    if (source === 'F4_TEST_INBOUND' || source === 'F5_TEST_INBOUND') return true;
    if (!this.configBoolean('SOFIA_QR_PILOT_ALLOWLIST_ENABLED')) return true;
    const allowedPhones = (process.env.SOFIA_QR_PILOT_ALLOWED_PHONES ?? this.configService.get<string>('SOFIA_QR_PILOT_ALLOWED_PHONES') ?? '')
      .split(',')
      .map((phone) => this.normalizePhoneForAllowlist(phone))
      .filter(Boolean);
    if (allowedPhones.length === 0) return false;
    return allowedPhones.includes(this.normalizePhoneForAllowlist(parsed.phone));
  }

  private configBoolean(key: string) {
    const value = process.env[key] ?? this.configService.get<boolean | string>(key);
    return value === true || String(value).toLowerCase() === 'true';
  }

  private normalizePhoneForAllowlist(phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('57') && digits.length === 12) return digits;
    if (digits.length === 10) return `57${digits}`;
    return digits;
  }

  private isUniqueConstraintError(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
  }
}
