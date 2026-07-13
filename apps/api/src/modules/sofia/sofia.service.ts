import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CashSessionStatus,
  DeliveryWorkflowStatus,
  OrderTicketType,
  Prisma,
  SofiaOrderDraftStatus,
  SofiaOrderSource,
  WhatsappConversationStatus,
  WhatsappDeliveryOrderStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
  WhatsappPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateMockConversationDto,
  CreateSofiaOrderDraftDto,
  SofiaOrderItemDto,
  UpdateSofiaOrderDraftDto,
} from './dto/sofia.dto';
import { hashPreview, redactPhone, redactSensitiveText } from './privacy/sofia-pii-redaction';

type SofiaItemSnapshot = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string | null;
};

const ORDER_PREFIXES = ['MOSTRADOR-', 'MESA-', 'DOMICILIO-', 'LLEVAR-'];

type InboxConversationRecord = {
  id: string;
  phone: string;
  customerName: string | null;
  status: WhatsappConversationStatus;
  provider: string;
  mode: string;
  sofiaEnabled: boolean;
  humanStatus: string;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  unreadCount: number;
  riskFlags: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    direction: WhatsappMessageDirection;
    provider: string;
    body: string | null;
    transcript: string | null;
    status: string;
    errorMessage: string | null;
    aiIntent: string | null;
    confidence: Prisma.Decimal | null;
    createdAt: Date;
  }>;
  outboundMessages: Array<{
    id: string;
    body: string;
    mediaUrl: string | null;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    sentAt: Date | null;
  }>;
  _count: {
    deliveryOrders: number;
    orderDrafts: number;
  };
};

@Injectable()
export class SofiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  private normalizePhone(phone: string) {
    return phone.replace(/[^\d+]/g, '').trim();
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    if (value == null) {
      return 0;
    }
    return Number(value);
  }

  private readItemsSnapshot(value: Prisma.JsonValue): SofiaItemSnapshot[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items = value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const record = item as Record<string, unknown>;
        return {
          productId: String(record.productId ?? ''),
          code: String(record.code ?? ''),
          name: String(record.name ?? ''),
          quantity: Number(record.quantity ?? 0),
          unitPrice: Number(record.unitPrice ?? 0),
          totalPrice: Number(record.totalPrice ?? 0),
          notes: typeof record.notes === 'string' ? record.notes : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.productId && item.quantity > 0));

    return items;
  }

  private missingFields(input: {
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    items: SofiaItemSnapshot[];
  }) {
    const missing: string[] = [];
    if (!input.customerName?.trim()) missing.push('customerName');
    if (!input.customerPhone?.trim()) missing.push('customerPhone');
    if (!input.deliveryAddress?.trim()) missing.push('deliveryAddress');
    if (!input.items.length) missing.push('items');
    return missing;
  }

  private resolveDraftStatus(input: {
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    items: SofiaItemSnapshot[];
  }) {
    return this.missingFields(input).length ? SofiaOrderDraftStatus.NEEDS_INFO : SofiaOrderDraftStatus.READY_TO_CONFIRM;
  }

  private async buildItemsSnapshot(items: SofiaOrderItemDto[] = []) {
    const snapshots: SofiaItemSnapshot[] = [];

    for (const item of items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        select: {
          id: true,
          code: true,
          name: true,
          salePrice: true,
          isActive: true,
        },
      });

      if (!product || !product.isActive) {
        throw new BadRequestException('Uno de los productos no está disponible para Sofía.');
      }

      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice ?? product.salePrice);
      snapshots.push({
        productId: product.id,
        code: product.code,
        name: product.name,
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
        notes: item.notes?.trim() || null,
      });
    }

    return snapshots;
  }

  private draftMoney(items: SofiaItemSnapshot[], deliveryFee = 0) {
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const normalizedDeliveryFee = Math.max(Number(deliveryFee) || 0, 0);
    return {
      subtotal,
      deliveryFee: normalizedDeliveryFee,
      total: subtotal + normalizedDeliveryFee,
    };
  }

  private includeConversation() {
    return {
      messages: {
        orderBy: { createdAt: 'asc' as const },
      },
      outboundMessages: {
        orderBy: { createdAt: 'asc' as const },
      },
      orderDrafts: {
        orderBy: { createdAt: 'desc' as const },
        take: 10,
      },
      deliveryOrders: {
        orderBy: { createdAt: 'desc' as const },
        take: 10,
      },
    };
  }

  async getOrCreateConversation(dto: Pick<CreateMockConversationDto, 'phone' | 'customerName'>) {
    const phone = this.normalizePhone(dto.phone);
    if (!phone) {
      throw new BadRequestException('El teléfono es obligatorio para la conversación Sofía.');
    }

    const existing = await this.prisma.whatsappConversation.findFirst({
      where: {
        phone,
        status: {
          not: WhatsappConversationStatus.ARCHIVED,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      return this.prisma.whatsappConversation.update({
        where: { id: existing.id },
        data: {
          customerName: dto.customerName?.trim() || existing.customerName,
          lastMessageAt: new Date(),
        },
        include: this.includeConversation(),
      });
    }

    return this.prisma.whatsappConversation.create({
      data: {
        phone,
        customerName: dto.customerName?.trim() || null,
        source: SofiaOrderSource.WHATSAPP,
        lastMessageAt: new Date(),
      },
      include: this.includeConversation(),
    });
  }

  listConversations() {
    return this.prisma.whatsappConversation.findMany({
      include: this.includeConversation(),
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async getConversationsInbox() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const realOperationEnabled = false;
    const realSendingEnabled = this.configBoolean('WHATSAPP_QR_ALLOW_REAL_SEND') && false;
    const receiveOnly = (process.env.WHATSAPP_MODE ?? this.configService.get<string>('WHATSAPP_MODE')) === 'receive_only';
    const deepSeekEnabled = this.configBoolean('DEEPSEEK_ENABLED');
    const aiMode = process.env.SOFIA_AI_MODE ?? this.configService.get<string>('SOFIA_AI_MODE') ?? 'rules';

    const conversations = await this.prisma.whatsappConversation.findMany({
      select: {
        id: true,
        phone: true,
        customerName: true,
        status: true,
        provider: true,
        mode: true,
        sofiaEnabled: true,
        humanStatus: true,
        lastMessagePreview: true,
        lastMessageAt: true,
        lastInboundAt: true,
        unreadCount: true,
        riskFlags: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 24,
          select: {
            id: true,
            direction: true,
            provider: true,
            body: true,
            transcript: true,
            status: true,
            errorMessage: true,
            aiIntent: true,
            confidence: true,
            createdAt: true,
          },
        },
        outboundMessages: {
          orderBy: { createdAt: 'asc' },
          take: 24,
          select: {
            id: true,
            body: true,
            mediaUrl: true,
            status: true,
            attempts: true,
            lastError: true,
            createdAt: true,
            sentAt: true,
          },
        },
        _count: {
          select: {
            deliveryOrders: true,
            orderDrafts: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    });

    const mapped = conversations.map((conversation) =>
      this.toInboxConversation(conversation, { realOperationEnabled, todayStart, realSendingEnabled, deepSeekEnabled, aiMode }),
    );

    const real = mapped.filter((conversation) => conversation.scope === 'real');
    const internalValidation = mapped.filter((conversation) => conversation.scope === 'internal_validation');
    const sandbox = mapped.filter((conversation) => conversation.scope === 'sandbox');
    const historical = mapped.filter((conversation) => conversation.scope === 'historical');
    const visibleForSummary = [...real, ...internalValidation];

    return {
      generatedAt: now.toISOString(),
      scope: {
        realOperationEnabled,
        realOperationReason: 'ALLOWLIST_FINAL_PENDING',
        receiveOnly,
        sandboxHiddenByDefault: true,
        historicalHiddenByDefault: true,
      },
      real: {
        total: real.length,
        conversations: real,
      },
      internalValidation: {
        total: internalValidation.length,
        conversations: internalValidation,
      },
      sandbox: {
        total: sandbox.length,
        hiddenByDefault: true,
        conversations: sandbox,
      },
      historical: {
        total: historical.length,
        hiddenByDefault: true,
        conversations: historical,
      },
      filters: {
        allOperational: visibleForSummary.length,
        humanRequired: visibleForSummary.filter((conversation) => conversation.signals.humanRequired).length,
        paymentSensitive: visibleForSummary.filter((conversation) => conversation.signals.paymentSensitive).length,
        unknownProduct: visibleForSummary.filter((conversation) => conversation.signals.unknownProduct).length,
        blocked: visibleForSummary.filter((conversation) => conversation.signals.blocked).length,
        aiSuggestions: visibleForSummary.filter((conversation) => conversation.signals.aiSuggestion).length,
      },
      summary: {
        totalConversations: mapped.length,
        realConversations: real.length,
        internalValidationConversations: internalValidation.length,
        sandboxConversations: sandbox.length,
        historicalConversations: historical.length,
        pendingReview: visibleForSummary.filter((conversation) => conversation.signals.pendingReview).length,
        outboundSent: real.reduce((sum, conversation) => sum + conversation.outboundSentCount, 0),
        internalValidationOutboundSent: internalValidation.reduce((sum, conversation) => sum + conversation.outboundSentCount, 0),
        sandboxOutboundSent: sandbox.reduce((sum, conversation) => sum + conversation.outboundSentCount, 0),
        historicalOutboundSent: historical.reduce((sum, conversation) => sum + conversation.outboundSentCount, 0),
      },
      security: {
        realSendingEnabled: false,
        autoReplyEnabled: false,
        productionEnabled: false,
        whatsappCanMarkPaid: false,
        deepSeekEnabled,
        aiMode,
        dataPolicy: {
          noSecrets: true,
          noPii: true,
          noQrRaw: true,
          noFullPhone: true,
          noSessionAuth: true,
          providerPayloadExcluded: true,
        },
      },
    };
  }

  async findConversation(id: string) {
    const conversation = await this.prisma.whatsappConversation.findUnique({
      where: { id },
      include: this.includeConversation(),
    });
    if (!conversation) {
      throw new NotFoundException('No se encontró la conversación Sofía/WhatsApp.');
    }
    return conversation;
  }

  private toInboxConversation(
    conversation: InboxConversationRecord,
    options: {
      realOperationEnabled: boolean;
      todayStart: Date;
      realSendingEnabled: boolean;
      deepSeekEnabled: boolean;
      aiMode: string;
    },
  ) {
    const textHaystack = [
      conversation.status,
      conversation.humanStatus,
      conversation.customerName ?? '',
      conversation.lastMessagePreview ?? '',
      ...conversation.messages.map((message) => `${message.status} ${message.errorMessage ?? ''} ${message.body ?? ''} ${message.transcript ?? ''}`),
      ...conversation.outboundMessages.map((outbound) => `${outbound.status} ${outbound.lastError ?? ''} ${outbound.body}`),
    ].join(' ');
    const lower = textHaystack.toLowerCase();
    const isSandbox =
      conversation.provider === 'mock' ||
      conversation.mode === 'mock' ||
      lower.includes('sandbox') ||
      lower.includes('cliente pago e2e') ||
      lower.includes('mock-');
    const isHistorical = !isSandbox && !options.realOperationEnabled && conversation.updatedAt < options.todayStart;
    const scope = isSandbox
      ? 'sandbox'
      : isHistorical
        ? 'historical'
        : options.realOperationEnabled
          ? 'real'
          : 'internal_validation';
    const technicalReasonCodes = this.extractReasonCodes(conversation, lower);
    const operationalReasons = technicalReasonCodes.map((code) => ({
      code,
      label: this.reasonCodeLabel(code),
    }));
    const signals = this.inboxSignals(conversation, lower, technicalReasonCodes);
    const lastText =
      conversation.lastMessagePreview ??
      [...conversation.messages].reverse().find((message) => message.body || message.transcript)?.body ??
      [...conversation.messages].reverse().find((message) => message.body || message.transcript)?.transcript ??
      null;

    return {
      id: conversation.id,
      scope,
      customerLabel: redactSensitiveText(conversation.customerName) ?? redactPhone(conversation.phone) ?? 'Cliente sin identificar',
      phoneMasked: redactPhone(conversation.phone),
      phoneHash: hashPreview(conversation.phone),
      provider: conversation.provider,
      mode: conversation.mode,
      status: conversation.status,
      humanStatus: conversation.humanStatus,
      sofiaEnabled: conversation.sofiaEnabled,
      lastMessagePreview: this.preview(lastText),
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
      unreadCount: conversation.unreadCount,
      operationalState: this.operationalState(signals, scope),
      recommendedAction: this.recommendedInboxAction(signals, scope),
      signals,
      operationalReasons,
      technicalReasonCodes,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        provider: message.provider,
        status: message.status,
        bodyPreview: this.preview(message.body ?? message.transcript),
        aiIntent: message.aiIntent,
        confidence: message.confidence == null ? null : Number(message.confidence),
        createdAt: message.createdAt.toISOString(),
      })),
      outboundMessages: conversation.outboundMessages.map((outbound) => ({
        id: outbound.id,
        bodyPreview: this.preview(outbound.body),
        hasMedia: Boolean(outbound.mediaUrl),
        status: outbound.status,
        attempts: outbound.attempts,
        lastError: outbound.lastError ? this.reasonCodeLabel(outbound.lastError) : null,
        createdAt: outbound.createdAt.toISOString(),
        sentAt: outbound.sentAt?.toISOString() ?? null,
        sent: outbound.status === 'SENT',
        realSendingEnabled: false,
      })),
      outboxTotal: conversation.outboundMessages.length,
      outboundSentCount: conversation.outboundMessages.filter((outbound) => outbound.status === 'SENT').length,
      relatedOperationCounts: {
        orderDrafts: conversation._count.orderDrafts,
        deliveryOrders: conversation._count.deliveryOrders,
      },
      ai: {
        provider: options.deepSeekEnabled ? 'deepseek' : 'rules',
        mode: options.aiMode,
        dryRun: options.deepSeekEnabled && options.aiMode === 'dry_run',
      },
      safety: {
        safetyGuard: true,
        sentFalseExpected: true,
        realSendingEnabled: false,
        whatsappCanMarkPaid: false,
      },
      updatedAt: conversation.updatedAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
    };
  }

  private extractReasonCodes(
    conversation: {
      status: string;
      humanStatus: string;
      outboundMessages: Array<{ status: string; lastError: string | null }>;
      messages: Array<{ status: string; errorMessage: string | null }>;
    },
    lower: string,
  ) {
    const raw = [
      conversation.status,
      conversation.humanStatus,
      ...conversation.messages.flatMap((message) => [message.status, message.errorMessage]),
      ...conversation.outboundMessages.flatMap((outbound) => [outbound.status, outbound.lastError]),
    ].filter((value): value is string => Boolean(value));
    const codes = new Set<string>();
    for (const value of raw) {
      if (/^[A-Z0-9_]{3,}$/.test(value)) codes.add(value);
    }
    if (lower.includes('nequi') || lower.includes('comprobante') || lower.includes('ya pag')) codes.add('PAYMENT_SENSITIVE');
    if (lower.includes('sushi')) codes.add('UNKNOWN_PRODUCT');
    if (lower.includes('hablar con alguien') || lower.includes('humano')) codes.add('HUMAN_REQUESTED');
    if (lower.includes('allowlist')) codes.add('ALLOWLIST_REQUIRED');
    if (lower.includes('blocked') || lower.includes('bloque')) codes.add('BLOCKED');
    return [...codes].sort();
  }

  private reasonCodeLabel(code: string) {
    const labels: Record<string, string> = {
      ADDRESS_MISSING: 'Falta dirección',
      ORDER_CONFIRMATION_MISSING: 'Falta confirmación del pedido',
      P0_COMMERCIAL: 'Requiere revisión comercial',
      MAXI_FAMILY_COPY_RISK: 'Riesgo comercial',
      COMMERCIAL_RULE: 'Requiere revisión comercial',
      UNKNOWN_PRODUCT: 'Producto no reconocido',
      PAYMENT_SENSITIVE: 'Pago sensible',
      LOW_CONFIDENCE: 'Baja confianza',
      HUMAN_REQUESTED: 'Cliente pidió humano',
      HUMAN_REQUIRED: 'Requiere revisión humana',
      HUMAN_TAKEN: 'Operador tomó la conversación',
      ALLOWLIST_REQUIRED: 'Número fuera de allowlist',
      DRAFT_ONLY: 'Borrador interno',
      BLOCKED: 'Bloqueada por seguridad',
      FAILED: 'Falló procesamiento',
      SENT: 'Envío real detectado',
      SUGGESTED: 'Sugerencia interna',
      APPROVAL_PENDING: 'Pendiente de aprobación',
      SOFIA_PAUSED: 'Sofía pausada',
      SOFIA_ACTIVE: 'Sofía activa',
      ACTIVE: 'Activa',
      RESOLVED: 'Resuelta',
      RECEIVED: 'Recibida',
      PROCESSED: 'Procesada',
      BLOCKED_REAL_SEND_DISABLED: 'Envío real bloqueado',
    };
    return labels[code] ?? code.replace(/_/g, ' ').toLowerCase();
  }

  private inboxSignals(
    conversation: { humanStatus: string; outboundMessages: Array<{ status: string }> },
    lower: string,
    technicalReasonCodes: string[],
  ) {
    const hasCode = (code: string) => technicalReasonCodes.includes(code);
    const aiSuggestion = conversation.outboundMessages.some((outbound) =>
      ['SUGGESTED', 'APPROVAL_PENDING', 'DRAFT_ONLY'].includes(outbound.status),
    );
    const blocked = conversation.outboundMessages.some((outbound) => outbound.status === 'SENT') || hasCode('BLOCKED') || hasCode('FAILED');
    const paymentSensitive = hasCode('PAYMENT_SENSITIVE');
    const unknownProduct = hasCode('UNKNOWN_PRODUCT');
    const humanRequired =
      hasCode('HUMAN_REQUIRED') ||
      hasCode('HUMAN_REQUESTED') ||
      conversation.humanStatus.includes('HUMAN') ||
      lower.includes('hablar con alguien');
    const allowlistPending = hasCode('ALLOWLIST_REQUIRED');
    return {
      humanRequired,
      paymentSensitive,
      unknownProduct,
      aiSuggestion,
      blocked,
      allowlistPending,
      pendingReview: humanRequired || paymentSensitive || unknownProduct || blocked || allowlistPending,
    };
  }

  private operationalState(
    signals: ReturnType<SofiaService['inboxSignals']>,
    scope: string,
  ) {
    if (scope === 'sandbox') return 'Sandbox';
    if (scope === 'historical') return 'Histórico';
    if (signals.blocked) return 'Bloqueada';
    if (signals.paymentSensitive) return 'Pago sensible';
    if (signals.unknownProduct) return 'Producto no reconocido';
    if (signals.humanRequired) return 'Requiere humano';
    if (signals.allowlistPending) return 'Allowlist pendiente';
    if (signals.aiSuggestion) return 'Sugerencia IA';
    return 'Monitoreo receive-only';
  }

  private recommendedInboxAction(
    signals: ReturnType<SofiaService['inboxSignals']>,
    scope: string,
  ) {
    if (scope === 'sandbox') return 'Revisar solo en sandbox; no es operación real';
    if (scope === 'historical') return 'Mantener como evidencia histórica';
    if (signals.blocked) return 'Revisar bloqueo antes de continuar';
    if (signals.paymentSensitive) return 'Pasar a humano; WhatsApp no marca PAID';
    if (signals.unknownProduct) return 'No inventar producto; responder con catálogo validado';
    if (signals.humanRequired) return 'Tomar humano o confirmar handoff';
    if (signals.allowlistPending) return 'Validar allowlist antes de procesar';
    if (signals.aiSuggestion) return 'Revisar sugerencia IA; no enviar real';
    return 'Monitorear receive-only';
  }

  private preview(value: string | null | undefined) {
    const clean = redactSensitiveText(value)?.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
  }

  private configBoolean(key: string) {
    const value = process.env[key] ?? this.configService.get<boolean | string>(key);
    return value === true || String(value).toLowerCase() === 'true';
  }

  async registerMockInbound(dto: CreateMockConversationDto, actorId: string) {
    const conversation = await this.getOrCreateConversation(dto);
    const message = await this.prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsappMessageDirection.INBOUND,
        type: WhatsappMessageType.TEXT,
        body: dto.body?.trim() || null,
        rawPayload: dto.rawPayload ? (dto.rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    await this.prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_MOCK_INBOUND',
      module: 'sofia',
      entity: 'whatsapp_conversation',
      entityId: conversation.id,
      newValues: { phone: conversation.phone },
    });

    return this.findConversation(conversation.id);
  }

  async registerMockOutbound(conversationId: string, body: string, rawPayload: Record<string, unknown> | undefined, actorId: string) {
    await this.findConversation(conversationId);
    const message = await this.prisma.whatsappMessage.create({
      data: {
        conversationId,
        direction: WhatsappMessageDirection.OUTBOUND,
        type: WhatsappMessageType.TEXT,
        body: body.trim(),
        rawPayload: rawPayload ? (rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_MOCK_OUTBOUND',
      module: 'sofia',
      entity: 'whatsapp_conversation',
      entityId: conversationId,
    });

    return this.findConversation(conversationId);
  }

  async handoffConversation(conversationId: string, assignedToUserId: string | undefined, actorId: string) {
    const conversation = await this.findConversation(conversationId);
    if (assignedToUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: assignedToUserId } });
      if (!user || !user.isActive) {
        throw new BadRequestException('El operador asignado no está disponible.');
      }
    }

    const updated = await this.prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        status: WhatsappConversationStatus.HUMAN_TAKEN,
        sofiaEnabled: false,
        assignedToUserId: assignedToUserId ?? actorId,
      },
      include: this.includeConversation(),
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_HANDOFF',
      module: 'sofia',
      entity: 'whatsapp_conversation',
      entityId: conversation.id,
    });

    return updated;
  }

  async resolveConversation(conversationId: string, actorId: string) {
    await this.findConversation(conversationId);
    const updated = await this.prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { status: WhatsappConversationStatus.RESOLVED },
      include: this.includeConversation(),
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_CONVERSATION_RESOLVED',
      module: 'sofia',
      entity: 'whatsapp_conversation',
      entityId: conversationId,
    });

    return updated;
  }

  async createDraft(dto: CreateSofiaOrderDraftDto, actorId: string) {
    if (dto.conversationId) {
      await this.findConversation(dto.conversationId);
    }

    const items = await this.buildItemsSnapshot(dto.items ?? []);
    const money = this.draftMoney(items, dto.deliveryFee);
    const missingFields = this.missingFields({
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      deliveryAddress: dto.deliveryAddress,
      items,
    });

    const draft = await this.prisma.sofiaOrderDraft.create({
      data: {
        conversationId: dto.conversationId || null,
        status: missingFields.length ? SofiaOrderDraftStatus.NEEDS_INFO : SofiaOrderDraftStatus.READY_TO_CONFIRM,
        customerName: dto.customerName?.trim() || null,
        customerPhone: dto.customerPhone ? this.normalizePhone(dto.customerPhone) : null,
        deliveryAddress: dto.deliveryAddress?.trim() || null,
        deliveryNeighborhood: dto.deliveryNeighborhood?.trim() || null,
        deliveryNotes: dto.deliveryNotes?.trim() || null,
        itemsSnapshot: items as unknown as Prisma.InputJsonValue,
        subtotal: money.subtotal,
        deliveryFee: money.deliveryFee,
        total: money.total,
        missingFields: missingFields.length ? missingFields : Prisma.JsonNull,
        aiSummary: dto.aiSummary?.trim() || null,
        source: SofiaOrderSource.SOFIA,
      },
      include: {
        conversation: true,
        deliveryOrder: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DRAFT_CREATE',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: draft.id,
      newValues: { source: draft.source, total: draft.total },
    });

    return draft;
  }

  listDrafts() {
    return this.prisma.sofiaOrderDraft.findMany({
      include: {
        conversation: true,
        deliveryOrder: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findDraft(id: string) {
    const draft = await this.prisma.sofiaOrderDraft.findUnique({
      where: { id },
      include: {
        conversation: true,
        deliveryOrder: true,
      },
    });
    if (!draft) {
      throw new NotFoundException('No se encontró el borrador Sofía.');
    }
    return draft;
  }

  async updateDraft(id: string, dto: UpdateSofiaOrderDraftDto, actorId: string) {
    const current = await this.findDraft(id);
    const finalStatuses: SofiaOrderDraftStatus[] = [
      SofiaOrderDraftStatus.CONFIRMED,
      SofiaOrderDraftStatus.CANCELLED,
      SofiaOrderDraftStatus.EXPIRED,
    ];
    if (finalStatuses.includes(current.status)) {
      throw new ConflictException('Este borrador ya no se puede editar.');
    }

    const existingItems = this.readItemsSnapshot(current.itemsSnapshot);
    const items = dto.items === undefined ? existingItems : await this.buildItemsSnapshot(dto.items);
    const customerName = dto.customerName === undefined ? current.customerName : dto.customerName?.trim() || null;
    const customerPhone =
      dto.customerPhone === undefined ? current.customerPhone : dto.customerPhone ? this.normalizePhone(dto.customerPhone) : null;
    const deliveryAddress = dto.deliveryAddress === undefined ? current.deliveryAddress : dto.deliveryAddress?.trim() || null;
    const money = this.draftMoney(items, dto.deliveryFee === undefined ? this.toNumber(current.deliveryFee) : dto.deliveryFee);
    const status = this.resolveDraftStatus({
      customerName,
      customerPhone,
      deliveryAddress,
      items,
    });
    const missingFields = this.missingFields({ customerName, customerPhone, deliveryAddress, items });

    const updated = await this.prisma.sofiaOrderDraft.update({
      where: { id },
      data: {
        customerName,
        customerPhone,
        deliveryAddress,
        deliveryNeighborhood:
          dto.deliveryNeighborhood === undefined ? current.deliveryNeighborhood : dto.deliveryNeighborhood?.trim() || null,
        deliveryNotes: dto.deliveryNotes === undefined ? current.deliveryNotes : dto.deliveryNotes?.trim() || null,
        aiSummary: dto.aiSummary === undefined ? current.aiSummary : dto.aiSummary?.trim() || null,
        itemsSnapshot: items as unknown as Prisma.InputJsonValue,
        subtotal: money.subtotal,
        deliveryFee: money.deliveryFee,
        total: money.total,
        status,
        missingFields: missingFields.length ? missingFields : Prisma.JsonNull,
      },
      include: {
        conversation: true,
        deliveryOrder: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DRAFT_UPDATE',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: id,
      newValues: { status: updated.status, total: updated.total },
    });

    return updated;
  }

  async confirmDraft(id: string, actorId: string) {
    const draft = await this.findDraft(id);
    if (draft.status === SofiaOrderDraftStatus.CONFIRMED) {
      return draft;
    }
    const blockedStatuses: SofiaOrderDraftStatus[] = [SofiaOrderDraftStatus.CANCELLED, SofiaOrderDraftStatus.EXPIRED];
    if (blockedStatuses.includes(draft.status)) {
      throw new ConflictException('No puedes confirmar un borrador cancelado o vencido.');
    }

    const items = this.readItemsSnapshot(draft.itemsSnapshot);
    const missingFields = this.missingFields({
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      deliveryAddress: draft.deliveryAddress,
      items,
    });
    if (missingFields.length) {
      throw new BadRequestException(`Faltan datos para confirmar: ${missingFields.join(', ')}`);
    }

    const updated = await this.prisma.sofiaOrderDraft.update({
      where: { id },
      data: {
        status: SofiaOrderDraftStatus.CONFIRMED,
        missingFields: Prisma.JsonNull,
      },
      include: {
        conversation: true,
        deliveryOrder: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DRAFT_CONFIRM',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: id,
    });

    return updated;
  }

  async cancelDraft(id: string, actorId: string) {
    await this.findDraft(id);
    const updated = await this.prisma.sofiaOrderDraft.update({
      where: { id },
      data: { status: SofiaOrderDraftStatus.CANCELLED },
      include: {
        conversation: true,
        deliveryOrder: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DRAFT_CANCEL',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: id,
    });

    return updated;
  }

  listDeliveryOrders() {
    return this.prisma.whatsappDeliveryOrder.findMany({
      include: {
        conversation: true,
        orderDraft: true,
        orderTicket: {
          include: {
            items: {
              include: { product: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findDeliveryOrder(id: string) {
    const order = await this.prisma.whatsappDeliveryOrder.findUnique({
      where: { id },
      include: {
        conversation: true,
        orderDraft: true,
        orderTicket: {
          include: {
            items: {
              include: { product: true },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('No se encontró el pedido WhatsApp/Sofía.');
    }
    return order;
  }

  async createDeliveryOrderFromDraft(draftId: string, actorId: string, createOperationalTicket = true) {
    const draft = await this.findDraft(draftId);
    if (draft.status !== SofiaOrderDraftStatus.CONFIRMED) {
      throw new BadRequestException('Primero confirma el borrador Sofía.');
    }
    if (draft.deliveryOrder) {
      return this.findDeliveryOrder(draft.deliveryOrder.id);
    }

    const items = this.readItemsSnapshot(draft.itemsSnapshot);
    if (!items.length) {
      throw new BadRequestException('El borrador no tiene productos.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let orderTicketId: string | null = null;

      if (createOperationalTicket) {
        const session = await tx.cashSession.findFirst({
          where: { status: CashSessionStatus.OPEN },
          orderBy: { openedAt: 'desc' },
        });
        if (!session) {
          throw new BadRequestException('Debes tener una caja abierta antes de enviar el pedido Sofía a operación.');
        }

        const deliveryCustomer = draft.customerPhone
          ? await tx.deliveryCustomer.upsert({
              where: { phone: draft.customerPhone },
              update: {
                fullName: draft.customerName,
                defaultAddress: draft.deliveryAddress,
                defaultReference: draft.deliveryNotes,
              },
              create: {
                phone: draft.customerPhone,
                fullName: draft.customerName,
                defaultAddress: draft.deliveryAddress,
                defaultReference: draft.deliveryNotes,
              },
            })
          : null;

        const orderTicket = await tx.orderTicket.create({
          data: {
            number: await this.generateOrderNumber(tx, OrderTicketType.DELIVERY),
            type: OrderTicketType.DELIVERY,
            customerName: draft.customerName,
            customerPhone: draft.customerPhone,
            deliveryReference: draft.deliveryAddress,
            deliveryAddressNormalized: draft.deliveryAddress,
            deliveryZoneLabel: draft.deliveryNeighborhood,
            deliveryFee: draft.deliveryFee,
            subtotal: draft.total,
            deliveryCustomerId: deliveryCustomer?.id ?? null,
            deliveryWorkflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
            deliveryStatusUpdatedAt: new Date(),
            notes: [
              'Origen: Sofía/WhatsApp',
              draft.deliveryNotes ? `Notas: ${draft.deliveryNotes}` : null,
            ].filter(Boolean).join('\n'),
            cashSessionId: session.id,
            createdById: actorId,
            items: {
              create: items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                notes: item.notes || undefined,
              })),
            },
          },
        });
        orderTicketId = orderTicket.id;
      }

      return tx.whatsappDeliveryOrder.create({
        data: {
          conversationId: draft.conversationId,
          orderDraftId: draft.id,
          orderTicketId,
          status: WhatsappDeliveryOrderStatus.CONFIRMED,
          paymentStatus: WhatsappPaymentStatus.UNSELECTED,
          customerNameSnapshot: draft.customerName,
          customerPhoneSnapshot: draft.customerPhone,
          deliveryAddressSnapshot: draft.deliveryAddress,
          deliveryNeighborhoodSnapshot: draft.deliveryNeighborhood,
          itemsSnapshot: draft.itemsSnapshot as Prisma.InputJsonValue,
          subtotal: draft.subtotal,
          deliveryFee: draft.deliveryFee,
          total: draft.total,
          source: SofiaOrderSource.WHATSAPP_SOFIA,
          createdByAgentNameSnapshot: 'Sofía',
        },
      });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DELIVERY_ORDER_CREATE',
      module: 'sofia',
      entity: 'whatsapp_delivery_order',
      entityId: created.id,
      newValues: {
        source: created.source,
        paymentStatus: created.paymentStatus,
        orderTicketId: created.orderTicketId,
      },
    });

    return this.findDeliveryOrder(created.id);
  }

  async updateDeliveryOrderStatus(id: string, status: WhatsappDeliveryOrderStatus, actorId: string) {
    await this.findDeliveryOrder(id);
    const updated = await this.prisma.whatsappDeliveryOrder.update({
      where: { id },
      data: { status },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_DELIVERY_ORDER_STATUS',
      module: 'sofia',
      entity: 'whatsapp_delivery_order',
      entityId: id,
      newValues: { status },
    });

    return this.findDeliveryOrder(updated.id);
  }

  private async generateOrderNumber(tx: Prisma.TransactionClient, type: OrderTicketType) {
    const prefix = type === OrderTicketType.DELIVERY ? 'DOMICILIO' : 'MOSTRADOR';

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260331)`;
    const existingNumbers = await tx.orderTicket.findMany({
      where: {
        OR: ORDER_PREFIXES.map((knownPrefix) => ({
          number: { startsWith: knownPrefix },
        })),
      },
      select: { number: true },
    });

    const lastSequence = existingNumbers.reduce((highest, order) => {
      const currentSequence = Number.parseInt(order.number.split('-').pop() ?? '0', 10) || 0;
      return Math.max(highest, currentSequence);
    }, 0);

    return `${prefix}-${String(lastSequence + 1).padStart(3, '0')}`;
  }
}
