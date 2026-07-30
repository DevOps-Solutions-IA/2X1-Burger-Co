import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OrderTicketStatus, OrderTicketType, Prisma, SofiaOrderSource, WhatsappPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PaymentProviderFactory } from './payments/payment-provider.factory';
import { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';

type PublicPaymentMethod = 'ONLINE' | 'NEQUI_MANUAL' | 'CASH';
type OperatorPaymentStatus = 'FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';

type SofiaPaymentItem = {
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

const DEFAULT_SETTINGS_ID = 'default';

@Injectable()
export class SofiaPaymentLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
    private readonly paymentProviderFactory: PaymentProviderFactory,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    if (value == null) return 0;
    return Number(value);
  }

  private publicBaseUrl() {
    const configured = process.env.PUBLIC_PAYMENTS_BASE_URL?.trim() || 'http://localhost:3301';
    return configured.replace(/\/+$/, '');
  }

  private buildPaymentUrl(token: string) {
    return `${this.publicBaseUrl()}/pagos/${token}`;
  }

  private async getOrCreatePaymentSettings(tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    return tx.sofiaPaymentSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID },
      update: {},
      create: { id: DEFAULT_SETTINGS_ID },
    });
  }

  private buildAvailablePaymentMethods(
    settings: Awaited<ReturnType<SofiaPaymentLinkService['getOrCreatePaymentSettings']>>,
    productiveActionsAllowed = false,
  ) {
    return [
      {
        method: 'ONLINE' as const,
        label: 'Pagar en línea',
        description: settings.onlinePaymentsEnabled
          ? settings.onlinePaymentProvider === 'MOCK'
            ? 'Pago online mock controlado para desarrollo.'
            : 'Pago online provider-ready.'
          : 'Pago en línea aún no disponible. Puedes elegir efectivo o Nequi.',
        enabled:
          productiveActionsAllowed &&
          settings.onlinePaymentsEnabled &&
          ((settings.onlinePaymentProvider === 'MOCK' && settings.mockOnlinePaymentsEnabled && process.env.NODE_ENV !== 'production') ||
            (settings.onlinePaymentProvider === 'BOLD' && settings.boldEnabled)),
      },
      {
        method: 'NEQUI_MANUAL' as const,
        label: 'Transferir a Nequi',
        description: settings.nequiManualPhone
          ? 'Transferencia manual pendiente de verificación por operador.'
          : 'Nequi no está configurado todavía.',
        enabled: productiveActionsAllowed && settings.nequiManualEnabled && Boolean(settings.nequiManualPhone),
        phone: settings.nequiManualPhone,
        holderName: settings.nequiManualHolderName,
        instructionsText: settings.paymentInstructionsText,
      },
      {
        method: 'CASH' as const,
        label: 'Pago en efectivo',
        description: 'Pago contra entrega. El operador recauda al entregar.',
        enabled: productiveActionsAllowed && settings.cashEnabled,
      },
    ];
  }

  private generateToken() {
    return randomBytes(32).toString('base64url');
  }

  private parseItemsSnapshot(value: Prisma.JsonValue): SofiaPaymentItem[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item): SofiaPaymentItem | null => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        return {
          code: String(record.code ?? ''),
          name: String(record.name ?? ''),
          quantity: Number(record.quantity ?? 0),
          unitPrice: Number(record.unitPrice ?? 0),
          totalPrice: Number(record.totalPrice ?? 0),
          notes: typeof record.notes === 'string' ? record.notes : null,
        };
      })
      .filter((item): item is SofiaPaymentItem => Boolean(item?.name && item.quantity > 0));
  }

  private async generateUniqueToken(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = this.generateToken();
      const existing = await tx.whatsappDeliveryOrder.findUnique({
        where: { publicPaymentToken: token },
        select: { id: true },
      });
      if (!existing) return token;
    }
    throw new BadRequestException('No se pudo generar un token público seguro.');
  }

  private async generateUniqueReference(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const numeric = randomBytes(4).readUInt32BE(0) % 100000;
      const reference = `ORD-${String(numeric).padStart(5, '0')}`;
      const existing = await tx.whatsappDeliveryOrder.findUnique({
        where: { orderReference: reference },
        select: { id: true },
      });
      if (!existing) return reference;
    }
    throw new BadRequestException('No se pudo generar una referencia pública.');
  }

  private async createPaymentEvent(
    tx: Prisma.TransactionClient,
    input: {
      whatsappDeliveryOrderId: string;
      orderTicketId?: string | null;
      actorId?: string | null;
      eventType: string;
      paymentMethod?: string | null;
      previousStatus?: WhatsappPaymentStatus | null;
      newStatus: WhatsappPaymentStatus;
      message?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    await tx.sofiaPaymentEvent.create({
      data: {
        whatsappDeliveryOrderId: input.whatsappDeliveryOrderId,
        orderTicketId: input.orderTicketId ?? null,
        actorId: input.actorId ?? null,
        eventType: input.eventType,
        paymentMethod: input.paymentMethod ?? null,
        previousStatus: input.previousStatus ?? null,
        newStatus: input.newStatus,
        message: input.message ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  private publishPaymentOrderRefresh(orderTicket: { id: string; type: OrderTicketType; status: OrderTicketStatus } | null, actorId: string | null) {
    if (!orderTicket) return;
    this.realtimeService.publishOrderUpdated({
      entityId: orderTicket.id,
      orderType: orderTicket.type,
      status: orderTicket.status,
      actorId,
    });
    this.realtimeService.publishOperationalRefresh('orders');
  }

  private async findSofiaDeliveryOrderByOrderTicket(orderTicketId: string) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderTicketId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        whatsappDeliveryOrder: true,
      },
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda.');
    }
    if (order.type !== OrderTicketType.DELIVERY || !order.whatsappDeliveryOrder) {
      throw new BadRequestException('Solo los pedidos Sofía de domicilio pueden generar link público.');
    }
    if (
      order.whatsappDeliveryOrder.source !== SofiaOrderSource.WHATSAPP_SOFIA &&
      order.whatsappDeliveryOrder.createdByAgentNameSnapshot !== 'Sofía'
    ) {
      throw new BadRequestException('La comanda no pertenece a Sofía.');
    }
    return order;
  }

  async getOperationalLink(orderTicketId: string) {
    const order = await this.findSofiaDeliveryOrderByOrderTicket(orderTicketId);
    const deliveryOrder = order.whatsappDeliveryOrder;
    if (!deliveryOrder) {
      throw new BadRequestException('Solo los pedidos Sofía de domicilio pueden generar link público.');
    }
    return {
      orderReference: deliveryOrder.orderReference,
      publicPaymentUrl: deliveryOrder.publicPaymentToken ? this.buildPaymentUrl(deliveryOrder.publicPaymentToken) : null,
      expiresAt: deliveryOrder.publicPaymentTokenExpiresAt,
      paymentLinkCreatedAt: deliveryOrder.paymentLinkCreatedAt,
      paymentLinkLastOpenedAt: deliveryOrder.paymentLinkLastOpenedAt,
      paymentLinkOpenCount: deliveryOrder.paymentLinkOpenCount,
      paymentStatus: deliveryOrder.paymentStatus,
      paymentMethod: deliveryOrder.paymentMethod,
      provider: deliveryOrder.onlinePaymentProvider,
      checkoutUrl: deliveryOrder.providerCheckoutUrl,
    };
  }

  async getPaymentSettings() {
    return this.getOrCreatePaymentSettings();
  }

  async updatePaymentSettings(
    dto: {
      cashEnabled?: boolean;
      nequiManualEnabled?: boolean;
      nequiManualPhone?: string | null;
      nequiManualHolderName?: string | null;
      prepareCashOrdersImmediately?: boolean;
      prepareManualTransferBeforeVerification?: boolean;
      manualPaymentRequiresOperator?: boolean;
      paymentInstructionsText?: string | null;
      onlinePaymentsEnabled?: boolean;
      onlinePaymentProvider?: 'MOCK' | 'BOLD' | 'NONE';
      mockOnlinePaymentsEnabled?: boolean;
      boldEnabled?: boolean;
      paymentLinkTtlMinutes?: number;
      onlinePaymentExpiresMinutes?: number;
      prepareOnlineOrdersBeforePaid?: boolean;
    },
    actorId: string,
  ) {
    if (dto.onlinePaymentsEnabled === true || dto.boldEnabled === true) {
      const gate = await this.runtimeSafetyService.evaluate('PRODUCTIVE_ACTION');
      if (!gate.allowed) {
        await this.runtimeSafetyService.recordBlocked('PRODUCTIVE_ACTION', {
          actorId,
          reason: gate.reason,
          blockers: gate.blockers,
          idempotencyKey: 'sofia-payment-settings-enable',
        });
        throw new BadRequestException('Los pagos externos no pueden habilitarse mientras producción está bloqueada.');
      }
    }
    const updated = await this.prisma.sofiaPaymentSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID },
      update: {
        ...(dto.cashEnabled != null ? { cashEnabled: dto.cashEnabled } : {}),
        ...(dto.nequiManualEnabled != null ? { nequiManualEnabled: dto.nequiManualEnabled } : {}),
        ...(dto.nequiManualPhone !== undefined ? { nequiManualPhone: dto.nequiManualPhone?.trim() || null } : {}),
        ...(dto.nequiManualHolderName !== undefined ? { nequiManualHolderName: dto.nequiManualHolderName?.trim() || null } : {}),
        ...(dto.prepareCashOrdersImmediately != null
          ? { prepareCashOrdersImmediately: dto.prepareCashOrdersImmediately }
          : {}),
        ...(dto.prepareManualTransferBeforeVerification != null
          ? { prepareManualTransferBeforeVerification: dto.prepareManualTransferBeforeVerification }
          : {}),
        ...(dto.manualPaymentRequiresOperator != null
          ? { manualPaymentRequiresOperator: dto.manualPaymentRequiresOperator }
          : {}),
        ...(dto.paymentInstructionsText !== undefined ? { paymentInstructionsText: dto.paymentInstructionsText?.trim() || null } : {}),
        ...(dto.onlinePaymentsEnabled != null ? { onlinePaymentsEnabled: dto.onlinePaymentsEnabled } : {}),
        ...(dto.onlinePaymentProvider != null ? { onlinePaymentProvider: dto.onlinePaymentProvider } : {}),
        ...(dto.mockOnlinePaymentsEnabled != null ? { mockOnlinePaymentsEnabled: dto.mockOnlinePaymentsEnabled } : {}),
        ...(dto.boldEnabled != null ? { boldEnabled: dto.boldEnabled } : {}),
        ...(dto.paymentLinkTtlMinutes != null ? { paymentLinkTtlMinutes: dto.paymentLinkTtlMinutes } : {}),
        ...(dto.onlinePaymentExpiresMinutes != null ? { onlinePaymentExpiresMinutes: dto.onlinePaymentExpiresMinutes } : {}),
        ...(dto.prepareOnlineOrdersBeforePaid != null ? { prepareOnlineOrdersBeforePaid: dto.prepareOnlineOrdersBeforePaid } : {}),
      },
      create: {
        id: DEFAULT_SETTINGS_ID,
        cashEnabled: dto.cashEnabled ?? true,
        nequiManualEnabled: dto.nequiManualEnabled ?? true,
        nequiManualPhone: dto.nequiManualPhone?.trim() || null,
        nequiManualHolderName: dto.nequiManualHolderName?.trim() || null,
        prepareCashOrdersImmediately: dto.prepareCashOrdersImmediately ?? true,
        prepareManualTransferBeforeVerification: dto.prepareManualTransferBeforeVerification ?? false,
        manualPaymentRequiresOperator: dto.manualPaymentRequiresOperator ?? true,
        paymentInstructionsText: dto.paymentInstructionsText?.trim() || null,
        onlinePaymentsEnabled: dto.onlinePaymentsEnabled ?? false,
        onlinePaymentProvider: dto.onlinePaymentProvider ?? 'NONE',
        mockOnlinePaymentsEnabled: dto.mockOnlinePaymentsEnabled ?? false,
        boldEnabled: dto.boldEnabled ?? false,
        paymentLinkTtlMinutes: dto.paymentLinkTtlMinutes ?? 1440,
        onlinePaymentExpiresMinutes: dto.onlinePaymentExpiresMinutes ?? 20,
        prepareOnlineOrdersBeforePaid: dto.prepareOnlineOrdersBeforePaid ?? false,
        autoMarkPaidFromWebhook: false,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_PAYMENT_SETTINGS_UPDATE',
      module: 'sofia',
      entity: 'sofia_payment_settings',
      entityId: updated.id,
      newValues: {
        cashEnabled: updated.cashEnabled,
        nequiManualEnabled: updated.nequiManualEnabled,
        hasNequiManualPhone: Boolean(updated.nequiManualPhone),
        onlinePaymentsEnabled: updated.onlinePaymentsEnabled,
        onlinePaymentProvider: updated.onlinePaymentProvider,
        mockOnlinePaymentsEnabled: updated.mockOnlinePaymentsEnabled,
        boldEnabled: updated.boldEnabled,
      },
    });

    return updated;
  }

  async generateOperationalLink(orderTicketId: string, actorId: string) {
    const gate = await this.runtimeSafetyService.evaluate('PRODUCTIVE_ACTION');
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('PRODUCTIVE_ACTION', {
        actorId,
        reason: gate.reason,
        blockers: gate.blockers,
        idempotencyKey: `payment-link:${orderTicketId}`,
      });
      throw new BadRequestException(
        'Los links de pago están bloqueados mientras Sofía no esté habilitada para producción.',
      );
    }
    const order = await this.findSofiaDeliveryOrderByOrderTicket(orderTicketId);
    const deliveryOrder = order.whatsappDeliveryOrder;
    if (!deliveryOrder) {
      throw new BadRequestException('Solo los pedidos Sofía de domicilio pueden generar link público.');
    }
    const now = new Date();
    const settings = await this.getOrCreatePaymentSettings();
    const expiresAt = new Date(now.getTime() + settings.paymentLinkTtlMinutes * 60 * 1000);

    const updated = await this.prisma.$transaction(async (tx) => {
      const token = await this.generateUniqueToken(tx);
      const orderReference =
        deliveryOrder.orderReference ?? (await this.generateUniqueReference(tx));

      return tx.whatsappDeliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          publicPaymentToken: token,
          publicPaymentTokenExpiresAt: expiresAt,
          paymentLinkCreatedAt: now,
          orderReference,
        },
      });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_PAYMENT_LINK_GENERATE',
      module: 'sofia',
      entity: 'whatsapp_delivery_order',
      entityId: updated.id,
      newValues: {
        orderTicketId,
        orderReference: updated.orderReference,
        expiresAt: updated.publicPaymentTokenExpiresAt,
      },
    });

    this.realtimeService.publishOrderUpdated({
      entityId: order.id,
      orderType: order.type,
      status: order.status,
      actorId,
    });
    this.realtimeService.publishOperationalRefresh('orders');

    return {
      orderReference: updated.orderReference,
      publicPaymentUrl: updated.publicPaymentToken ? this.buildPaymentUrl(updated.publicPaymentToken) : null,
      expiresAt: updated.publicPaymentTokenExpiresAt,
      paymentLinkCreatedAt: updated.paymentLinkCreatedAt,
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
      provider: updated.onlinePaymentProvider,
      checkoutUrl: updated.providerCheckoutUrl,
    };
  }

  async getPublicPayment(token: string) {
    const paymentToken = token.trim();
    if (!paymentToken || paymentToken.length < 24) {
      throw new NotFoundException('No encontramos este pedido. Escríbenos por WhatsApp para ayudarte.');
    }

    const deliveryOrder = await this.prisma.whatsappDeliveryOrder.findUnique({
      where: { publicPaymentToken: paymentToken },
      include: {
        orderTicket: {
          select: {
            status: true,
            deliveryWorkflowStatus: true,
          },
        },
      },
    });

    if (!deliveryOrder) {
      throw new NotFoundException('No encontramos este pedido. Escríbenos por WhatsApp para ayudarte.');
    }

    const now = new Date();
    await this.prisma.whatsappDeliveryOrder.update({
      where: { id: deliveryOrder.id },
      data: {
        paymentLinkLastOpenedAt: now,
        paymentLinkOpenCount: { increment: 1 },
      },
    });

    const expiresAt = deliveryOrder.publicPaymentTokenExpiresAt;
    const expired = Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
    if (expired) {
      return {
        expired: true,
        orderReference: deliveryOrder.orderReference,
        expiresAt,
        message: 'Este link venció. Escríbenos y te generamos uno nuevo.',
      };
    }

    const [settings, safetyState] = await Promise.all([
      this.getOrCreatePaymentSettings(),
      this.runtimeSafetyService.getState(),
    ]);
    const productiveActionsAllowed: boolean = safetyState.effective.productionEnabled;

    return {
      expired: false,
      orderReference: deliveryOrder.orderReference,
      customerName: deliveryOrder.customerNameSnapshot,
      deliveryAddress: deliveryOrder.deliveryAddressSnapshot,
      deliveryNeighborhood: deliveryOrder.deliveryNeighborhoodSnapshot,
      items: this.parseItemsSnapshot(deliveryOrder.itemsSnapshot),
      subtotal: this.toNumber(deliveryOrder.subtotal),
      deliveryFee: this.toNumber(deliveryOrder.deliveryFee),
      total: this.toNumber(deliveryOrder.total),
      currency: 'COP',
      orderStatus: deliveryOrder.orderTicket?.status ?? deliveryOrder.status,
      deliveryStatus: deliveryOrder.orderTicket?.deliveryWorkflowStatus ?? null,
      paymentStatus: deliveryOrder.paymentStatus,
      paymentMethod: deliveryOrder.paymentMethod,
      onlinePaymentProvider: deliveryOrder.onlinePaymentProvider,
      providerCheckoutUrl: deliveryOrder.providerCheckoutUrl,
      providerStatus: deliveryOrder.providerStatus,
      source: 'SOFIA',
      availablePaymentMethods: this.buildAvailablePaymentMethods(settings, productiveActionsAllowed),
      expiresAt,
      message: productiveActionsAllowed
        ? 'Revisa tu pedido y elige cómo quieres pagar.'
        : 'Consulta de pedido disponible. La selección de pago está bloqueada mientras producción está deshabilitada.',
    };
  }

  async selectPublicPaymentMethod(token: string, method: PublicPaymentMethod) {
    if (!['ONLINE', 'NEQUI_MANUAL', 'CASH'].includes(method)) {
      throw new BadRequestException('Método de pago no disponible.');
    }

    const gate = await this.runtimeSafetyService.evaluate('PRODUCTIVE_ACTION');
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('PRODUCTIVE_ACTION', {
        reason: gate.reason,
        blockers: gate.blockers,
      });
      throw new BadRequestException(
        'La selección de pago está bloqueada mientras Sofía no esté habilitada para producción.',
      );
    }

    const deliveryOrder = await this.prisma.whatsappDeliveryOrder.findUnique({
      where: { publicPaymentToken: token.trim() },
      include: {
        orderTicket: {
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
      },
    });

    if (!deliveryOrder) {
      throw new NotFoundException('No encontramos este pedido. Escríbenos por WhatsApp para ayudarte.');
    }
    if (deliveryOrder.publicPaymentTokenExpiresAt && deliveryOrder.publicPaymentTokenExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Este link venció. Escríbenos y te generamos uno nuevo.');
    }

    const settings = await this.getOrCreatePaymentSettings();
    const availableMethod = this.buildAvailablePaymentMethods(settings).find((entry) => entry.method === method);
    if (!availableMethod?.enabled) {
      throw new BadRequestException('Método de pago no disponible.');
    }

    if (method === 'ONLINE') {
      return this.createOnlinePaymentAttempt(deliveryOrder, settings);
    }

    const nextStatus =
      method === 'CASH'
        ? WhatsappPaymentStatus.CASH_ON_DELIVERY
        : WhatsappPaymentStatus.PENDING_MANUAL_VERIFICATION;

    const previousStatus = deliveryOrder.paymentStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.whatsappDeliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          paymentMethod: method,
          paymentStatus: nextStatus,
          paymentMethodSelectedAt: new Date(),
        },
      });

      await this.createPaymentEvent(tx, {
        whatsappDeliveryOrderId: deliveryOrder.id,
        orderTicketId: deliveryOrder.orderTicket?.id,
        eventType:
          method === 'CASH'
            ? 'CASH_CONFIRMED_BY_CUSTOMER'
            : method === 'NEQUI_MANUAL'
              ? 'NEQUI_TRANSFER_DECLARED_BY_CUSTOMER'
              : 'ONLINE_SELECTED_NO_PROVIDER',
        paymentMethod: method,
        previousStatus,
        newStatus: nextStatus,
        message:
          method === 'CASH'
            ? 'Cliente confirmó pago en efectivo contra entrega.'
            : method === 'NEQUI_MANUAL'
              ? 'Cliente declaró transferencia Nequi pendiente de verificación.'
              : 'Cliente seleccionó pago online futuro sin proveedor activo.',
      });

      return saved;
    });

    this.publishPaymentOrderRefresh(deliveryOrder.orderTicket, null);

    return {
          paymentStatus: updated.paymentStatus,
          paymentMethod: updated.paymentMethod,
      message:
        method === 'CASH'
          ? 'Pago en efectivo contra entrega confirmado.'
          : method === 'NEQUI_MANUAL'
            ? 'Transferencia pendiente de verificación.'
            : 'Método registrado para revisión.',
    };
  }

  private async createOnlinePaymentAttempt(
    deliveryOrder: Prisma.WhatsappDeliveryOrderGetPayload<{
      include: {
        orderTicket: {
          select: {
            id: true;
            type: true;
            status: true;
          };
        };
      };
    }>,
    settings: Awaited<ReturnType<SofiaPaymentLinkService['getOrCreatePaymentSettings']>>,
  ) {
    const gate = await this.runtimeSafetyService.evaluate('PRODUCTIVE_ACTION');
    if (!gate.allowed) {
      await this.runtimeSafetyService.recordBlocked('PRODUCTIVE_ACTION', {
        reason: gate.reason,
        blockers: gate.blockers,
        idempotencyKey: `online-payment:${deliveryOrder.id}`,
      });
      throw new BadRequestException('El pago en línea está bloqueado mientras Sofía no esté habilitada para producción.');
    }
    if (!deliveryOrder.orderReference) {
      throw new BadRequestException('Primero genera la referencia pública del pedido.');
    }
    const provider = this.paymentProviderFactory.resolveFromSettings(settings);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + settings.onlinePaymentExpiresMinutes * 60 * 1000);
    const payment = await provider.createPayment({
      orderReference: deliveryOrder.orderReference,
      amount: this.toNumber(deliveryOrder.total),
      currency: 'COP',
      customerName: deliveryOrder.customerNameSnapshot,
      customerPhone: deliveryOrder.customerPhoneSnapshot,
      description: `Pedido Sofia ${deliveryOrder.orderReference}`,
      metadata: {
        whatsappDeliveryOrderId: deliveryOrder.id,
        orderTicketId: deliveryOrder.orderTicket?.id ?? null,
      },
    });

    const previousStatus = deliveryOrder.paymentStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.whatsappDeliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          paymentMethod: 'ONLINE',
          paymentStatus: WhatsappPaymentStatus.PENDING_ONLINE_PAYMENT,
          paymentMethodSelectedAt: now,
          onlinePaymentProvider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          providerReference: payment.providerReference,
          providerCheckoutUrl: payment.checkoutUrl,
          providerStatus: payment.status,
          onlinePaymentCreatedAt: now,
          onlinePaymentExpiresAt: expiresAt,
          paymentFailureReason: null,
          paymentReviewReason: null,
        },
      });

      await this.createPaymentEvent(tx, {
        whatsappDeliveryOrderId: deliveryOrder.id,
        orderTicketId: deliveryOrder.orderTicket?.id,
        eventType: 'ONLINE_PAYMENT_CREATED',
        paymentMethod: 'ONLINE',
        previousStatus,
        newStatus: WhatsappPaymentStatus.PENDING_ONLINE_PAYMENT,
        message: 'Cliente inició pago online. Pendiente de confirmación por webhook.',
        metadata: payment.rawPayload as Prisma.InputJsonValue,
      });

      return saved;
    });

    this.publishPaymentOrderRefresh(deliveryOrder.orderTicket, null);

    return {
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
      provider: updated.onlinePaymentProvider,
      checkoutUrl: updated.providerCheckoutUrl,
      message: 'Pago en línea iniciado. Continúa al checkout seguro.',
    };
  }

  async updateManualPaymentStatus(
    orderTicketId: string,
    input: { status: OperatorPaymentStatus; paymentMethod?: PublicPaymentMethod; message?: string },
    actorId: string,
  ) {
    if (!['FAILED', 'MANUAL_REVIEW', 'CANCELLED'].includes(input.status)) {
      throw new BadRequestException('Estado manual de pago no permitido.');
    }

    const order = await this.findSofiaDeliveryOrderByOrderTicket(orderTicketId);
    const deliveryOrder = order.whatsappDeliveryOrder;
    if (!deliveryOrder) {
      throw new BadRequestException('Solo los pedidos Sofía de domicilio pueden validar pagos manuales.');
    }

    const nextStatus = input.status as WhatsappPaymentStatus;
    const paymentMethod = input.paymentMethod ?? (deliveryOrder.paymentMethod as PublicPaymentMethod | null) ?? null;
    const previousStatus = deliveryOrder.paymentStatus;

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.whatsappDeliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          paymentStatus: nextStatus,
          paymentMethod,
        },
      });

      await this.createPaymentEvent(tx, {
        whatsappDeliveryOrderId: deliveryOrder.id,
        orderTicketId,
        actorId,
        eventType:
          nextStatus === WhatsappPaymentStatus.FAILED
              ? 'OPERATOR_MARKED_FAILED'
              : nextStatus === WhatsappPaymentStatus.MANUAL_REVIEW
                ? 'OPERATOR_SENT_MANUAL_REVIEW'
                : 'OPERATOR_CANCELLED_PAYMENT',
        paymentMethod,
        previousStatus,
        newStatus: nextStatus,
        message: input.message ?? null,
      });

      return saved;
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_PAYMENT_MANUAL_STATUS_UPDATE',
      module: 'sofia',
      entity: 'whatsapp_delivery_order',
      entityId: updated.id,
      oldValues: {
        paymentStatus: previousStatus,
        paymentMethod: deliveryOrder.paymentMethod,
      },
      newValues: {
        paymentStatus: updated.paymentStatus,
        paymentMethod: updated.paymentMethod,
      },
    });

    this.publishPaymentOrderRefresh(
      { id: order.id, type: order.type, status: order.status },
      actorId,
    );

    return {
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
      manuallyVerifiedAt: updated.manuallyVerifiedAt,
      manuallyVerifiedById: updated.manuallyVerifiedById,
    };
  }

  async processPaymentWebhook(
    providerName: string,
    rawPayload: unknown,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ) {
    const provider = this.paymentProviderFactory.resolve(providerName.toUpperCase());
    const parsed = provider.parseWebhook(rawPayload, headers);
    const signatureValid = provider.verifyWebhookSignature(rawPayload, headers, rawBody);

    const lookupClauses = [
      ...(parsed.orderReference ? [{ orderReference: parsed.orderReference }] : []),
      ...(parsed.providerReference ? [{ providerReference: parsed.providerReference }] : []),
      ...(parsed.providerPaymentId ? [{ providerPaymentId: parsed.providerPaymentId }] : []),
    ];
    const deliveryOrder = lookupClauses.length
      ? await this.prisma.whatsappDeliveryOrder.findFirst({
          where: {
            onlinePaymentProvider: provider.provider,
            OR: lookupClauses,
          },
          include: {
            orderTicket: {
              select: {
                id: true,
                type: true,
                status: true,
              },
            },
          },
        })
      : null;

    if (!signatureValid) {
      await this.recordWebhookOnly({
        // An unauthenticated event id must never reserve the provider's
        // idempotency key and suppress a later valid webhook.
        parsed: { ...parsed, eventId: null },
        provider: provider.provider,
        deliveryOrderId: deliveryOrder?.id,
        signatureValid,
        processedStatus: 'SIGNATURE_INVALID',
      });
      if (deliveryOrder) {
        await this.prisma.$transaction((tx) =>
          this.createPaymentEvent(tx, {
            whatsappDeliveryOrderId: deliveryOrder.id,
            orderTicketId: deliveryOrder.orderTicketId,
            eventType: 'WEBHOOK_SIGNATURE_INVALID',
            paymentMethod: 'ONLINE',
            previousStatus: deliveryOrder.paymentStatus,
            newStatus: deliveryOrder.paymentStatus,
            message: 'Webhook rechazado por firma inválida.',
            metadata: this.privacyService.sanitizeJson(parsed.rawPayload) as Prisma.InputJsonValue,
          }),
        );
      }
      return { processedStatus: 'SIGNATURE_INVALID', paymentStatus: deliveryOrder?.paymentStatus ?? null };
    }

    if (parsed.eventId) {
      const existing = await this.prisma.paymentWebhookEvent.findUnique({
        where: { eventId: parsed.eventId },
      });
      if (existing) {
        return {
          processedStatus: 'DUPLICATE_IGNORED',
          paymentStatus: null,
          eventId: parsed.eventId,
        };
      }
    }

    if (!deliveryOrder) {
      await this.recordWebhookOnly({
        parsed,
        provider: provider.provider,
        signatureValid,
        processedStatus: 'REFERENCE_UNKNOWN',
      });
      return { processedStatus: 'REFERENCE_UNKNOWN', paymentStatus: null };
    }

    const expectedAmount = this.toNumber(deliveryOrder.total);
    const amountMatches = parsed.amount != null && parsed.amount === expectedAmount;
    const currencyMatches = parsed.currency === 'COP';
    let nextStatus =
      parsed.status === 'APPROVED' || parsed.status === 'REVIEW'
        ? WhatsappPaymentStatus.MANUAL_REVIEW
        : parsed.status === 'FAILED'
          ? WhatsappPaymentStatus.FAILED
          : WhatsappPaymentStatus.PENDING_ONLINE_PAYMENT;
    let processedStatus = 'PROCESSED';
    let eventType = 'WEBHOOK_RECEIVED';
    let message = 'Webhook recibido y procesado.';

    if (!amountMatches || !currencyMatches) {
      nextStatus = WhatsappPaymentStatus.MANUAL_REVIEW;
      processedStatus = !amountMatches ? 'AMOUNT_MISMATCH' : 'CURRENCY_MISMATCH';
      eventType = !amountMatches ? 'WEBHOOK_AMOUNT_MISMATCH' : 'WEBHOOK_CURRENCY_MISMATCH';
      message = !amountMatches
        ? 'Webhook enviado a revisión por diferencia de monto.'
        : 'Webhook enviado a revisión por moneda inválida.';
    } else if (parsed.status === 'APPROVED') {
      processedStatus = 'PROVIDER_APPROVAL_REQUIRES_RECONCILIATION';
      eventType = 'WEBHOOK_APPROVAL_REQUIRES_RECONCILIATION';
      message = 'Webhook firmado aprobado; conciliación financiera requerida fuera de Sofía.';
    } else if (deliveryOrder.paymentStatus === WhatsappPaymentStatus.PAID && nextStatus === WhatsappPaymentStatus.FAILED) {
      nextStatus = WhatsappPaymentStatus.MANUAL_REVIEW;
      processedStatus = 'FAILED_AFTER_PAID_REVIEW';
      eventType = 'WEBHOOK_MARKED_REVIEW';
      message = 'Webhook fallido posterior a pago aprobado enviado a revisión manual.';
    } else if (nextStatus === WhatsappPaymentStatus.FAILED) {
      eventType = 'WEBHOOK_MARKED_FAILED';
      message = 'Webhook válido marcó el pago online como fallido.';
    } else if (nextStatus === WhatsappPaymentStatus.MANUAL_REVIEW) {
      eventType = 'WEBHOOK_MARKED_REVIEW';
      message = 'Webhook envió el pago a revisión manual.';
    }

    const previousStatus = deliveryOrder.paymentStatus;
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.paymentWebhookEvent.create({
        data: {
          whatsappDeliveryOrderId: deliveryOrder.id,
          provider: provider.provider,
          eventId: parsed.eventId,
          providerPaymentId: parsed.providerPaymentId,
          providerReference: parsed.providerReference,
          orderReference: parsed.orderReference,
          eventType: parsed.eventType,
          status: parsed.status,
          amount: parsed.amount,
          currency: parsed.currency,
          signatureValid,
          processedStatus,
          rawPayload: this.privacyService.sanitizeJson(parsed.rawPayload) as Prisma.InputJsonValue,
          processedAt: now,
        },
      });

      const saved = await tx.whatsappDeliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          paymentMethod: 'ONLINE',
          paymentStatus: nextStatus,
          onlinePaymentProvider: provider.provider,
          providerPaymentId: parsed.providerPaymentId ?? deliveryOrder.providerPaymentId,
          providerReference: parsed.providerReference ?? deliveryOrder.providerReference,
          providerStatus: parsed.status,
          webhookLastEventAt: now,
          webhookEventCount: { increment: 1 },
          ...(nextStatus === WhatsappPaymentStatus.FAILED ? { paymentFailureReason: message } : {}),
          ...(nextStatus === WhatsappPaymentStatus.MANUAL_REVIEW ? { paymentReviewReason: message } : {}),
        },
      });

      await this.createPaymentEvent(tx, {
        whatsappDeliveryOrderId: deliveryOrder.id,
        orderTicketId: deliveryOrder.orderTicketId,
        eventType,
        paymentMethod: 'ONLINE',
        previousStatus,
        newStatus: saved.paymentStatus,
        message,
        metadata: {
          webhookEventId: webhook.id,
          provider: provider.provider,
          processedStatus,
        },
      });

      return saved;
    });

    this.publishPaymentOrderRefresh(deliveryOrder.orderTicket, null);

    return {
      processedStatus,
      paymentStatus: updated.paymentStatus,
      provider: updated.onlinePaymentProvider,
      providerStatus: updated.providerStatus,
    };
  }

  private async recordWebhookOnly(input: {
    parsed: {
      eventId: string | null;
      eventType: string;
      providerPaymentId: string | null;
      providerReference: string | null;
      orderReference: string | null;
      status: string;
      amount: number | null;
      currency: string | null;
      rawPayload: Record<string, unknown>;
    };
    provider: string;
    deliveryOrderId?: string | null;
    signatureValid: boolean;
    processedStatus: string;
  }) {
    await this.prisma.paymentWebhookEvent.create({
      data: {
        whatsappDeliveryOrderId: input.deliveryOrderId ?? null,
        provider: input.provider,
        eventId: input.parsed.eventId,
        providerPaymentId: input.parsed.providerPaymentId,
        providerReference: input.parsed.providerReference,
        orderReference: input.parsed.orderReference,
        eventType: input.parsed.eventType,
        status: input.parsed.status,
        amount: input.parsed.amount,
        currency: input.parsed.currency,
        signatureValid: input.signatureValid,
        processedStatus: input.processedStatus,
        rawPayload: this.privacyService.sanitizeJson(input.parsed.rawPayload) as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  }

  async simulateMockWebhook(input: {
    orderReference?: string;
    providerReference?: string;
    providerPaymentId?: string;
    status: 'PAID' | 'FAILED' | 'REVIEW';
    amount?: number;
    currency?: string;
    eventId?: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Webhook mock no disponible en producción.');
    }
    const payload = {
      eventId: input.eventId ?? `mock_evt_${randomBytes(8).toString('hex')}`,
      eventType: `mock.payment.${input.status.toLowerCase()}`,
      providerPaymentId: input.providerPaymentId ?? null,
      providerReference: input.providerReference ?? null,
      orderReference: input.orderReference ?? null,
      status: input.status,
      amount: input.amount,
      currency: input.currency ?? 'COP',
    };
    return this.processPaymentWebhook('mock', payload, {
      'x-mock-payment-signature': 'mock-dev-signature',
    });
  }

  async listPaymentEvents(orderTicketId: string) {
    const order = await this.findSofiaDeliveryOrderByOrderTicket(orderTicketId);
    const deliveryOrder = order.whatsappDeliveryOrder;
    if (!deliveryOrder) {
      throw new BadRequestException('Solo los pedidos Sofía de domicilio tienen eventos de pago.');
    }

    return this.prisma.sofiaPaymentEvent.findMany({
      where: { whatsappDeliveryOrderId: deliveryOrder.id },
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            fullName: true,
            accessName: true,
          },
        },
      },
      take: 25,
    });
  }
}
