import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  CashMovementType,
  CashSessionStatus,
  DeliveryIssueStatus,
  DeliveryIssueType,
  DeliveryLocationInboxStatus,
  DiningTableStatus,
  InventoryMovementType,
  DeliveryWorkflowStatus,
  OperationalAlertSeverity,
  OperationalAlertStatus,
  OrderTicketStatus,
  OrderTicketType,
  Prisma,
  ProductKind,
  SaleChannel,
  SaleStatus,
} from '@prisma/client';
import QRCode from 'qrcode';
import { renderDeliveryReceiptPdf } from './delivery-receipt.renderer';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal, toNumber } from '../../common/utils/decimal.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateSaleDto } from '../sales/dto/create-sale.dto';
import { SalesService } from '../sales/sales.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SofiaPaymentLinkService } from '../sofia/sofia-payment-link.service';
import { TablesService } from '../tables/tables.service';
import { DeliveryPricingService } from '../../delivery/delivery-pricing/delivery-pricing.service';
import { CheckoutOrderTicketDto } from './dto/checkout-order-ticket.dto';
import { AssignDeliveryRiderDto } from './dto/assign-delivery-rider.dto';
import { ClaimOrderTicketDto } from './dto/claim-order-ticket.dto';
import { CreateOrderTicketDto } from './dto/create-order-ticket.dto';
import { ReplaceOrderTicketItemsDto } from './dto/replace-order-ticket-items.dto';
import { ReopenOrderTicketDto } from './dto/reopen-order-ticket.dto';
import { SyncWaiterOrderDto } from './dto/sync-waiter-order.dto';
import { UpdateDeliveryWorkflowDto } from './dto/update-delivery-workflow.dto';
import { UpdateOrderTicketDto } from './dto/update-order-ticket.dto';
import { normalizeSearchText, normalizePhone, normalizeAddressText as normalizeAddrForCustomer } from '../../common/normalization/customer-normalization';

const ACTIVE_ORDER_STATUSES: OrderTicketStatus[] = [
  OrderTicketStatus.OPEN,
  OrderTicketStatus.IN_PREPARATION,
  OrderTicketStatus.SERVED,
  OrderTicketStatus.PAYMENT_PENDING,
];

const orderInclude = {
  table: true,
  sale: {
    include: {
      payments: {
        include: {
          paymentMethod: true,
        },
      },
    },
  },
  createdBy: true,
  assignedWaiter: {
    select: {
      id: true,
      fullName: true,
      accessName: true,
    },
  },
  assignedRider: {
    select: {
      id: true,
      fullName: true,
    },
  },
  whatsappDeliveryOrder: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      publicPaymentTokenExpiresAt: true,
      paymentLinkCreatedAt: true,
      paymentLinkLastOpenedAt: true,
      paymentLinkOpenCount: true,
      paymentMethodSelectedAt: true,
      manuallyVerifiedAt: true,
      manuallyVerifiedById: true,
      orderReference: true,
      onlinePaymentProvider: true,
      providerPaymentId: true,
      providerReference: true,
      providerCheckoutUrl: true,
      providerStatus: true,
      onlinePaymentCreatedAt: true,
      onlinePaymentExpiresAt: true,
      onlinePaymentPaidAt: true,
      webhookLastEventAt: true,
      webhookEventCount: true,
      paymentFailureReason: true,
      paymentReviewReason: true,
      source: true,
      createdByAgentNameSnapshot: true,
      customerNameSnapshot: true,
      customerPhoneSnapshot: true,
      manuallyVerifiedBy: {
        select: {
          id: true,
          fullName: true,
          accessName: true,
        },
      },
      paymentEvents: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              accessName: true,
            },
          },
        },
      },
    },
  },
  items: {
    include: {
      product: {
        include: {
          category: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.OrderTicketInclude;

const waiterOrderSelect = {
  id: true,
  number: true,
  revision: true,
  status: true,
  type: true,
  tableId: true,
  assignedWaiterId: true,
  waiterNameSnapshot: true,
  waiterAccessNameSnapshot: true,
  assignedAt: true,
  customerName: true,
  customerPhone: true,
  notes: true,
  subtotal: true,
  deliveryFee: true,
  deliveryFeeSuggested: true,
  deliveryFeeEdited: true,
  deliveryFeeEditReason: true,
  deliveryPricingStatus: true,
  deliveryPricingConfidence: true,
  deliveryPricingBreakdown: true,
  deliveryCalculationVersion: true,
  deliveryRequiresManualQuote: true,
  deliveryRouteProvider: true,
  deliveryWeatherProvider: true,
  deliveryGeocodingProvider: true,
  deliveryEstimatedMinutes: true,
  deliveryDistanceKm: true,
  deliveryZoneLabel: true,
  deliveryReference: true,
  deliveryLatitude: true,
  deliveryLongitude: true,
  deliveryLocationSource: true,
  deliveryLocationReceivedAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: {
    select: {
      id: true,
      fullName: true,
    },
  },
  assignedWaiter: {
    select: {
      id: true,
      fullName: true,
      accessName: true,
    },
  },
  assignedRider: {
    select: {
      id: true,
      fullName: true,
    },
  },
  deliveryWorkflowStatus: true,
  assignedRiderId: true,
  assignedRiderAt: true,
  deliveryDispatchedAt: true,
  deliveryDeliveredAt: true,
  deliveryIssueAt: true,
  table: {
    select: {
      id: true,
      label: true,
      area: true,
      capacity: true,
    },
  },
  items: {
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: {
        select: {
          name: true,
          code: true,
          kind: true,
          currentStock: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
} as const;

const deliveryOrderSelect = {
  id: true,
  number: true,
  status: true,
  type: true,
  tableId: true,
  assignedRiderId: true,
  assignedRiderAt: true,
  deliveryWorkflowStatus: true,
  deliveryStatusUpdatedAt: true,
  deliveryDispatchedAt: true,
  deliveryDeliveredAt: true,
  deliveryIssueAt: true,
  customerName: true,
  customerPhone: true,
  deliveryReference: true,
  deliveryAddressNormalized: true,
  deliveryLatitude: true,
  deliveryLongitude: true,
  deliveryDistanceKm: true,
  deliveryZoneLabel: true,
  deliveryFee: true,
  deliveryLocationSource: true,
  deliveryLocationReceivedAt: true,
  notes: true,
  subtotal: true,
  updatedAt: true,
  createdById: true,
  createdBy: {
    select: {
      id: true,
      fullName: true,
    },
  },
  assignedRider: {
    select: {
      id: true,
      fullName: true,
    },
  },
  whatsappDeliveryOrder: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      publicPaymentTokenExpiresAt: true,
      paymentLinkCreatedAt: true,
      paymentLinkLastOpenedAt: true,
      paymentLinkOpenCount: true,
      paymentMethodSelectedAt: true,
      manuallyVerifiedAt: true,
      manuallyVerifiedById: true,
      orderReference: true,
      onlinePaymentProvider: true,
      providerPaymentId: true,
      providerReference: true,
      providerCheckoutUrl: true,
      providerStatus: true,
      onlinePaymentCreatedAt: true,
      onlinePaymentExpiresAt: true,
      onlinePaymentPaidAt: true,
      webhookLastEventAt: true,
      webhookEventCount: true,
      paymentFailureReason: true,
      paymentReviewReason: true,
      source: true,
      createdByAgentNameSnapshot: true,
      customerNameSnapshot: true,
      customerPhoneSnapshot: true,
      manuallyVerifiedBy: {
        select: {
          id: true,
          fullName: true,
          accessName: true,
        },
      },
      paymentEvents: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              accessName: true,
            },
          },
        },
      },
    },
  },
  deliveryIssues: {
    where: {
      status: DeliveryIssueStatus.OPEN,
    },
    select: {
      id: true,
      issueType: true,
      summary: true,
      details: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 1,
  },
  table: {
    select: {
      id: true,
      label: true,
      area: true,
      capacity: true,
    },
  },
  items: {
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: {
        select: {
          name: true,
          code: true,
          kind: true,
          currentStock: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
} as const;

const ACTIVE_DELIVERY_WORKFLOW_STATUSES: DeliveryWorkflowStatus[] = [
  DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
  DeliveryWorkflowStatus.ASSIGNED,
  DeliveryWorkflowStatus.IN_TRANSIT,
  DeliveryWorkflowStatus.ISSUE,
];

const DELIVERY_PAYMENT_METHOD_LABEL = 'Nequi';
const DELIVERY_PAYMENT_TARGET = '3160527403';

type DeliveryReceiptSender = {
  sendDeliveryOrderSummary: (
    orderId: string,
    actorId: string,
    options?: { updated?: boolean; reason?: string; idempotencyKey?: string },
  ) => Promise<{ success: boolean; phone: string; orderNumber: string; updated?: boolean; sentAt: string }>;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly salesService: SalesService,
    private readonly realtimeService: RealtimeService,
    private readonly deliveryPricingService: DeliveryPricingService,
    private readonly tablesService: TablesService,
    private readonly sofiaPaymentLinkService: SofiaPaymentLinkService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private isPrivilegedOrderOperator(actor: AuthUser) {
    return actor.roles.some((role) => ['admin', 'cashier', 'supervisor'].includes(role));
  }

  private getEffectiveOrderOwnerId(order: {
    assignedWaiterId?: string | null;
    createdById: string;
  }) {
    return order.assignedWaiterId ?? order.createdById;
  }

  private getEffectiveOrderOwnerName(order: {
    assignedWaiterId?: string | null;
    waiterNameSnapshot?: string | null;
    assignedWaiter?: { fullName: string } | null;
    createdBy?: { fullName: string } | null;
  }) {
    return order.waiterNameSnapshot ?? order.assignedWaiter?.fullName ?? order.createdBy?.fullName ?? 'otro mesero';
  }

  private maskPhoneForAudit(phone?: string | null) {
    const normalized = this.normalizeDeliveryPhone(phone);
    if (!normalized) {
      return null;
    }
    return `${'*'.repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
  }

  private normalizeItemSnapshotForComparison(
    items: Array<{
      productId: string;
      quantity: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      totalPrice: Prisma.Decimal | number;
      notes?: string | null;
    }>,
  ) {
    return items
      .map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        notes: item.notes?.trim() ?? '',
      }))
      .sort((left, right) => {
        const byProduct = left.productId.localeCompare(right.productId);
        if (byProduct !== 0) return byProduct;
        const byNotes = left.notes.localeCompare(right.notes);
        if (byNotes !== 0) return byNotes;
        return left.quantity - right.quantity || left.unitPrice - right.unitPrice || left.totalPrice - right.totalPrice;
      });
  }

  private areCommercialItemsEqual(
    currentItems: Array<{
      productId: string;
      quantity: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      totalPrice: Prisma.Decimal | number;
      notes?: string | null;
    }>,
    nextItems: Array<{
      productId: string;
      quantity: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      totalPrice: Prisma.Decimal | number;
      notes?: string | null;
    }>,
  ) {
    return (
      JSON.stringify(this.normalizeItemSnapshotForComparison(currentItems)) ===
      JSON.stringify(this.normalizeItemSnapshotForComparison(nextItems))
    );
  }

  private async resolveDeliveryReceiptSender() {
    try {
      const { WhatsappService } = await import('../whatsapp/whatsapp.service');
      return this.moduleRef.get(WhatsappService, { strict: false }) as DeliveryReceiptSender;
    } catch {
      return null;
    }
  }

  private readAuditJsonObject(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private sanitizeDeliveryReceiptSendFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown_error');
    return message.replace(/\+?\d[\d\s\-()]{7,}\d/g, '[phone-redacted]').slice(0, 240);
  }

  private async hasUpdatedDeliveryReceiptSent(orderId: string, revision: number) {
    const previousSentLogs = await this.prisma.auditLog.findMany({
      where: {
        module: 'orders',
        entity: 'order_ticket',
        entityId: orderId,
        action: 'DELIVERY_UPDATED_RECEIPT_SENT',
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return previousSentLogs.some((log) => this.readAuditJsonObject(log.newValues).revision === revision);
  }

  private async sendUpdatedDeliveryReceiptAfterCommercialChange(input: {
    order: {
      id: string;
      number: string;
      revision: number;
      customerPhone: string | null;
      subtotal: Prisma.Decimal | number;
    };
    actorId: string;
    previousTotal: Prisma.Decimal | number;
  }) {
    const idempotencyKey = `DELIVERY_RECEIPT_UPDATED_SENT:${input.order.id}:${input.order.revision}`;
    const phoneMasked = this.maskPhoneForAudit(input.order.customerPhone);

    await this.auditService.log({
      userId: input.actorId,
      action: 'DELIVERY_UPDATED_RECEIPT_SEND_REQUESTED',
      module: 'orders',
      entity: 'order_ticket',
      entityId: input.order.id,
      newValues: {
        revision: input.order.revision,
        previousTotal: input.previousTotal,
        newTotal: input.order.subtotal,
        receiptUpdated: true,
        sendAttempted: Boolean(phoneMasked),
        phoneMasked,
        idempotencyKey,
      },
    });

    if (!phoneMasked) {
      await this.auditService.log({
        userId: input.actorId,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_FAILED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: input.order.id,
        newValues: {
          revision: input.order.revision,
          previousTotal: input.previousTotal,
          newTotal: input.order.subtotal,
          receiptUpdated: true,
          sendAttempted: false,
          sendSucceeded: false,
          failureReason: 'CUSTOMER_PHONE_MISSING',
          phoneMasked: null,
          idempotencyKey,
        },
      });
      return;
    }

    if (await this.hasUpdatedDeliveryReceiptSent(input.order.id, input.order.revision)) {
      return;
    }

    const sender = await this.resolveDeliveryReceiptSender();
    if (!sender) {
      await this.auditService.log({
        userId: input.actorId,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_FAILED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: input.order.id,
        newValues: {
          revision: input.order.revision,
          previousTotal: input.previousTotal,
          newTotal: input.order.subtotal,
          receiptUpdated: true,
          sendAttempted: true,
          sendSucceeded: false,
          failureReason: 'WHATSAPP_SERVICE_UNAVAILABLE',
          phoneMasked,
          idempotencyKey,
        },
      });
      return;
    }

    try {
      await sender.sendDeliveryOrderSummary(input.order.id, input.actorId, {
        updated: true,
        reason: 'commercial_order_change',
        idempotencyKey,
      });
      await this.auditService.log({
        userId: input.actorId,
        action: 'DELIVERY_UPDATED_RECEIPT_SENT',
        module: 'orders',
        entity: 'order_ticket',
        entityId: input.order.id,
        newValues: {
          revision: input.order.revision,
          previousTotal: input.previousTotal,
          newTotal: input.order.subtotal,
          receiptUpdated: true,
          sendAttempted: true,
          sendSucceeded: true,
          phoneMasked,
          idempotencyKey,
        },
      });
    } catch (error) {
      await this.auditService.log({
        userId: input.actorId,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_FAILED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: input.order.id,
        newValues: {
          revision: input.order.revision,
          previousTotal: input.previousTotal,
          newTotal: input.order.subtotal,
          receiptUpdated: true,
          sendAttempted: true,
          sendSucceeded: false,
          failureReason: this.sanitizeDeliveryReceiptSendFailure(error),
          phoneMasked,
          idempotencyKey,
        },
      });
    }
  }

  private getWaiterAssignmentSnapshot(actor: AuthUser) {
    return {
      assignedWaiterId: actor.sub,
      assignedAt: new Date(),
      waiterNameSnapshot: actor.fullName,
      waiterAccessNameSnapshot: actor.accessName ?? null,
    };
  }

  private assertWaiterOrderWriteAccess(
    order: {
      createdById: string;
      assignedWaiterId?: string | null;
      waiterNameSnapshot?: string | null;
      createdBy?: { fullName: string } | null;
      assignedWaiter?: { fullName: string } | null;
    },
    actor: AuthUser,
    options?: { allowClaim?: boolean },
  ) {
    if (this.isPrivilegedOrderOperator(actor) || !actor.roles.includes('waiter')) {
      return { shouldAssign: false };
    }

    const effectiveOwnerId = this.getEffectiveOrderOwnerId(order);
    if (effectiveOwnerId === actor.sub) {
      return { shouldAssign: !order.assignedWaiterId };
    }

    if (!order.assignedWaiterId && options?.allowClaim) {
      return { shouldAssign: true };
    }

    throw new ConflictException(
      !order.assignedWaiterId
        ? 'La comanda no está a tu cargo. Debes tomarla antes de guardar cambios.'
        : `La comanda la atiende ${this.getEffectiveOrderOwnerName(order)}.`,
    );
  }

  async findWaiterActive(actor: AuthUser) {
    const where: Prisma.OrderTicketWhereInput = {
      status: {
        in: ACTIVE_ORDER_STATUSES,
      },
    };

    if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
      where.type = OrderTicketType.DINE_IN;
      if (await this.tablesService.hasAnyActiveWaiterAssignments()) {
        const tableIds = await this.tablesService.findAssignedTableIdsForWaiter(actor.sub);
        if (!tableIds.size) {
          return [];
        }
        where.tableId = { in: [...tableIds] };
      }
    }

    return this.prisma.orderTicket.findMany({
      where,
      select: waiterOrderSelect,
      orderBy: { openedAt: 'desc' },
    });
  }

  findDeliveryActive(actor: AuthUser) {
    return this.prisma.orderTicket.findMany({
      where: {
        type: OrderTicketType.DELIVERY,
        status: {
          in: ACTIVE_ORDER_STATUSES,
        },
        deliveryWorkflowStatus: {
          in: ACTIVE_DELIVERY_WORKFLOW_STATUSES,
        },
        ...(actor.roles.includes('delivery')
          ? {
              OR: [{ assignedRiderId: actor.sub }, { assignedRiderId: null }],
            }
          : {}),
      },
      select: deliveryOrderSelect,
      orderBy: [
        { assignedRiderId: 'asc' },
        { deliveryWorkflowStatus: 'asc' },
        { deliveryStatusUpdatedAt: 'desc' },
        { updatedAt: 'desc' },
        { openedAt: 'desc' },
      ],
    });
  }

  findAll(status?: string, activeOnly = false) {
    const filterStatuses = activeOnly
      ? ACTIVE_ORDER_STATUSES
      : status
        ? [status as OrderTicketStatus]
        : undefined;

    return this.prisma.orderTicket.findMany({
      where: {
        ...(filterStatuses
          ? {
              status: {
                in: filterStatuses,
              },
            }
          : {}),
      },
      include: orderInclude,
      orderBy: { openedAt: 'desc' },
    });
  }

  private assertDeliveryOrder(order: {
    type: OrderTicketType;
    status: OrderTicketStatus;
  }) {
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio usan este flujo.');
    }

    if (
      order.status === OrderTicketStatus.PAID ||
      order.status === OrderTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('La comanda ya está cerrada.');
    }
  }

  private assertDeliveryWorkflowAccess(
    order: {
      assignedRiderId?: string | null;
      assignedRider?: { fullName: string } | null;
    },
    actor: AuthUser,
    options?: { allowClaim?: boolean },
  ) {
    if (this.isPrivilegedOrderOperator(actor) || !actor.roles.includes('delivery')) {
      return { shouldAssignToActor: false };
    }

    if (order.assignedRiderId === actor.sub) {
      return { shouldAssignToActor: false };
    }

    if (!order.assignedRiderId && options?.allowClaim) {
      return { shouldAssignToActor: true };
    }

    throw new ConflictException(
      order.assignedRider?.fullName
        ? `El domicilio ya está asignado a ${order.assignedRider.fullName}.`
        : 'El domicilio no está asignado a tu usuario.',
    );
  }

  private buildDeliveryIssueSummary(issueType: DeliveryIssueType, fallback?: string | null) {
    if (fallback?.trim()) {
      return fallback.trim();
    }

    switch (issueType) {
      case DeliveryIssueType.CUSTOMER_UNREACHABLE:
        return 'El cliente no respondió durante el intento de entrega.';
      case DeliveryIssueType.INCOMPLETE_ADDRESS:
        return 'La dirección compartida por el cliente no es suficiente para completar la entrega.';
      case DeliveryIssueType.LOCATION_MISMATCH:
        return 'La ubicación recibida no coincide con la dirección informada para el domicilio.';
      case DeliveryIssueType.PAYMENT_PENDING:
        return 'El domicilio quedó bloqueado por una validación pendiente del pago.';
      case DeliveryIssueType.DELIVERY_REJECTED:
        return 'El cliente rechazó la entrega al momento del intento.';
      case DeliveryIssueType.ROUTE_INCIDENT:
        return 'Se reportó una novedad de ruta durante el reparto.';
      default:
        return 'Se registró una novedad operativa en el domicilio.';
    }
  }

  private async createOperationalAlert(input: {
    type: string;
    module: string;
    severity: OperationalAlertSeverity;
    title: string;
    message: string;
    entityType?: string | null;
    entityId?: string | null;
    actorId?: string | null;
    deliveryLocationInboxId?: string | null;
    deliveryIssueId?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  }) {
    const alert = await this.prisma.operationalAlert.create({
      data: {
        type: input.type,
        module: input.module,
        severity: input.severity,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorId: input.actorId ?? null,
        deliveryLocationInboxId: input.deliveryLocationInboxId ?? null,
        deliveryIssueId: input.deliveryIssueId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });

    this.realtimeService.publishOperationalAlertUpdated({
      alertId: alert.id,
      module: alert.module,
      severity: alert.severity,
      status: alert.status,
      entityType: alert.entityType,
      entityId: alert.entityId,
    });

    return alert;
  }

  private async resolveOperationalAlerts(input: {
    module?: string;
    entityType?: string;
    entityId?: string;
    types?: string[];
    resolvedById?: string | null;
  }) {
    const alerts = await this.prisma.operationalAlert.findMany({
      where: {
        ...(input.module ? { module: input.module } : {}),
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.types?.length ? { type: { in: input.types } } : {}),
        status: {
          in: [OperationalAlertStatus.OPEN, OperationalAlertStatus.ACKNOWLEDGED],
        },
      },
    });

    if (!alerts.length) {
      return;
    }

    await this.prisma.operationalAlert.updateMany({
      where: {
        id: {
          in: alerts.map((alert) => alert.id),
        },
      },
      data: {
        status: OperationalAlertStatus.RESOLVED,
        resolvedById: input.resolvedById ?? null,
        resolvedAt: new Date(),
      },
    });

    for (const alert of alerts) {
      this.realtimeService.publishOperationalAlertUpdated({
        alertId: alert.id,
        module: alert.module,
        severity: alert.severity,
        status: OperationalAlertStatus.RESOLVED,
        entityType: alert.entityType,
        entityId: alert.entityId,
      });
    }
  }

  private scoreDeliveryOrderPhoneMatch(candidatePhone: string, senderPhoneCandidates: string[]) {
    if (!candidatePhone || !senderPhoneCandidates.length) {
      return 0;
    }

    let bestScore = 0;
    for (const senderPhone of senderPhoneCandidates) {
      if (!senderPhone) {
        continue;
      }

      if (candidatePhone === senderPhone) {
        bestScore = Math.max(bestScore, 100);
        continue;
      }

      const senderSuffix = senderPhone.slice(-10);
      const candidateSuffix = candidatePhone.slice(-10);
      if (senderSuffix && candidateSuffix && senderSuffix === candidateSuffix) {
        bestScore = Math.max(bestScore, 80);
        continue;
      }

      if (candidatePhone.endsWith(senderPhone) || senderPhone.endsWith(candidatePhone)) {
        bestScore = Math.max(bestScore, 60);
      }
    }

    return bestScore;
  }

  private resolveDeliveryLocationMatch(
    activeDeliveryOrders: Array<{
      id: string;
      number: string;
      type: OrderTicketType;
      status: OrderTicketStatus;
      customerName: string | null;
      customerPhone: string | null;
      deliveryReference: string | null;
      deliveryCustomerId?: string | null;
      deliveryLatitude?: Prisma.Decimal | null;
      deliveryLongitude?: Prisma.Decimal | null;
      deliveryLocationSource?: string | null;
      deliveryLocationReceivedAt?: Date | null;
      deliveryAddressNormalized?: string | null;
      deliveryDistanceKm?: Prisma.Decimal | null;
      deliveryZoneLabel?: string | null;
      items: Array<{ totalPrice: Prisma.Decimal }>;
      updatedAt: Date;
      openedAt: Date;
    }>,
    senderPhoneCandidates: string[],
  ) {
    const normalizedCandidates = senderPhoneCandidates.filter(Boolean);
    const rankedMatches = activeDeliveryOrders
      .map((order) => ({
        order,
        normalizedPhone: this.normalizeDeliveryPhone(order.customerPhone),
        score: this.scoreDeliveryOrderPhoneMatch(this.normalizeDeliveryPhone(order.customerPhone), normalizedCandidates),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.order.updatedAt.getTime() - left.order.updatedAt.getTime();
      });

    if (rankedMatches.length === 1) {
      return { order: rankedMatches[0]!.order, rule: 'sender_phone_exact_or_suffix' };
    }

    if (rankedMatches.length > 1) {
      const distinctPhones = Array.from(new Set(rankedMatches.map((entry) => entry.normalizedPhone).filter(Boolean)));
      if (distinctPhones.length === 1) {
        return { order: rankedMatches[0]!.order, rule: 'same_phone_most_recent_active_order' };
      }
    }

    const distinctActivePhones = Array.from(
      new Set(
        activeDeliveryOrders
          .map((candidate) => this.normalizeDeliveryPhone(candidate.customerPhone))
          .filter((candidate) => Boolean(candidate)),
      ),
    );

    if (!normalizedCandidates.length && activeDeliveryOrders.length === 1) {
      return { order: activeDeliveryOrders[0], rule: 'single_active_delivery_order' };
    }

    if (!normalizedCandidates.length && distinctActivePhones.length === 1 && activeDeliveryOrders.length > 0) {
      return { order: activeDeliveryOrders[0], rule: 'single_active_phone_most_recent_order' };
    }

    return null;
  }

  async findOne(id: string) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    return order;
  }

  getSofiaPaymentLink(id: string) {
    return this.sofiaPaymentLinkService.getOperationalLink(id);
  }

  generateSofiaPaymentLink(id: string, actorId: string) {
    return this.sofiaPaymentLinkService.generateOperationalLink(id, actorId);
  }

  listSofiaPaymentEvents(id: string) {
    return this.sofiaPaymentLinkService.listPaymentEvents(id);
  }

  updateSofiaPaymentStatus(
    id: string,
    dto: { status: 'PAID' | 'FAILED' | 'MANUAL_REVIEW' | 'CANCELLED'; paymentMethod?: 'ONLINE' | 'NEQUI_MANUAL' | 'CASH'; message?: string },
    actorId: string,
  ) {
    return this.sofiaPaymentLinkService.updateManualPaymentStatus(id, dto, actorId);
  }

  /* Cuenta vigente para visualización: renderiza el estado actual de la orden
     con el tipo correcto (inicial o actualizada) sin generar auditoría nueva. */
  async generateCurrentDeliveryReceiptPdf(id: string) {
    const version = await this.getDeliveryCommercialVersion(id);
    return this.generateDeliveryReceiptPdf(id, { updated: version > 1, skipAudit: true });
  }

  async generateDeliveryReceiptPdf(
    id: string,
    options?: { updated?: boolean; actorId?: string; skipAudit?: boolean },
  ) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio pueden generar una cuenta pendiente.');
    }

    const settings = await this.prisma.setting.findMany({
      where: {
        key: {
          in: ['business.profile', 'pos.defaults'],
        },
      },
    });

    const settingsMap = new Map(settings.map((item) => [item.key, item.value as Record<string, unknown>]));
    const businessProfile = settingsMap.get('business.profile') ?? {};
    const posDefaults = settingsMap.get('pos.defaults') ?? {};

    const businessName =
      typeof businessProfile.name === 'string' && businessProfile.name.trim()
        ? businessProfile.name.trim()
        : '2X1 Burger Co.';
    const address = typeof businessProfile.address === 'string' ? businessProfile.address.trim() : '';
    const phone = typeof businessProfile.phone === 'string' ? businessProfile.phone.trim() : '';
    const receiptFooter =
      typeof posDefaults.receiptFooter === 'string' && posDefaults.receiptFooter.trim()
        ? posDefaults.receiptFooter.trim()
        : 'Gracias por tu pedido';
    const whatsappUrl = this.buildWhatsAppUrl(phone);
    const qrBuffer = whatsappUrl
      ? await QRCode.toBuffer(whatsappUrl, {
          margin: 1,
          width: 180,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        })
      : null;

    const version = await this.getDeliveryCommercialVersion(id);
    const itemsSubtotal = order.items.reduce((acc, item) => acc + Number(item.totalPrice), 0);

    const pdf = await renderDeliveryReceiptPdf({
      businessName,
      businessAddress: address || null,
      businessPhone: phone || null,
      receiptFooter,
      updated: Boolean(options?.updated),
      orderNumber: order.number,
      version,
      generatedAt: new Date(),
      customerName: order.customerName,
      deliveryReference: order.deliveryReference,
      notes: order.notes,
      paymentMethodLabel: DELIVERY_PAYMENT_METHOD_LABEL,
      paymentTarget: DELIVERY_PAYMENT_TARGET,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        notes: item.notes,
      })),
      itemsSubtotal,
      deliveryFee: Number(order.deliveryFee),
      total: Number(order.subtotal),
      qrBuffer,
    });

    if (!options?.updated && !options?.skipAudit) {
      await this.auditService.log({
        userId: options?.actorId,
        action: 'DELIVERY_RECEIPT_INITIAL_GENERATED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: order.id,
        newValues: {
          receiptVersion: version,
          receiptType: 'INITIAL',
          newTotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    return pdf;
  }

  /* Versión comercial de la cuenta: 1 (creación) + una por cada cambio comercial
     auditado. La columna `revision` NO sirve como versión: también se incrementa
     por eventos técnicos como la ubicación logistics-only. */
  async getDeliveryCommercialVersion(orderId: string): Promise<number> {
    const refreshed = await this.prisma.auditLog.count({
      where: {
        module: 'orders',
        entity: 'order_ticket',
        entityId: orderId,
        action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
      },
    });
    return refreshed + 1;
  }

  async getDeliveryReceiptStatus(orderId: string) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderId },
      select: { id: true, type: true, number: true, subtotal: true, deliveryFee: true, openedAt: true },
    });
    if (!order) throw new NotFoundException('No se encontró la comanda.');
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio tienen cuenta de domicilio.');
    }

    const version = await this.getDeliveryCommercialVersion(orderId);
    const sendEvents = await this.prisma.auditLog.findMany({
      where: {
        entityId: orderId,
        action: {
          in: [
            'DELIVERY_RECEIPT_INITIAL_SEND_REQUESTED',
            'DELIVERY_RECEIPT_INITIAL_SENT',
            'DELIVERY_RECEIPT_INITIAL_SEND_FAILED',
            'DELIVERY_UPDATED_RECEIPT_SEND_REQUESTED',
            'DELIVERY_UPDATED_RECEIPT_SENT',
            'DELIVERY_UPDATED_RECEIPT_SEND_FAILED',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const lastRefresh = await this.prisma.auditLog.findFirst({
      where: { entityId: orderId, action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED' },
      orderBy: { createdAt: 'desc' },
    });
    /* Compatibilidad con envíos iniciales previos al estándar de eventos. */
    const legacyInitialSend = await this.prisma.auditLog.findFirst({
      where: { entityId: orderId, module: 'whatsapp', entity: 'delivery_order_summary', action: 'SEND' },
      orderBy: { createdAt: 'desc' },
    });

    const latest = sendEvents[0] ?? null;
    let sendStatus: string = 'NOT_REQUESTED';
    let sentAt: string | null = null;
    if (latest) {
      const values = this.readAuditJsonObject(latest.newValues);
      if (latest.action.endsWith('_SENT')) {
        sendStatus = 'SENT';
        sentAt = latest.createdAt.toISOString();
      } else if (latest.action.endsWith('_SEND_FAILED')) {
        sendStatus = values.failureReason === 'CUSTOMER_PHONE_MISSING' ? 'SKIPPED_NO_PHONE' : 'FAILED';
      } else {
        sendStatus = 'PENDING';
      }
    } else if (legacyInitialSend) {
      sendStatus = 'SENT';
      sentAt = legacyInitialSend.createdAt.toISOString();
    }

    return {
      orderId: order.id,
      orderNumber: order.number,
      version,
      status: 'ACTIVE',
      total: Number(order.subtotal),
      deliveryFee: Number(order.deliveryFee),
      lastGeneratedAt: (lastRefresh?.createdAt ?? order.openedAt).toISOString(),
      sendStatus,
      sentAt,
    };
  }

  async getDeliveryReceiptHistory(orderId: string) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderId },
      select: { id: true, type: true, number: true, subtotal: true, openedAt: true },
    });
    if (!order) throw new NotFoundException('No se encontró la comanda.');
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio tienen historial de cuenta.');
    }

    const [refreshEvents, itemEvents, createEvent] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entityId: orderId, action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED' },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { entityId: orderId, module: 'orders', action: 'UPDATE_ITEMS' },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditLog.findFirst({
        where: { entityId: orderId, module: 'orders', action: 'CREATE' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const snapshots: Array<Array<{ productId: string; quantity: number }>> = [];
    const createItems = this.readAuditItems(createEvent?.newValues);
    if (createItems) snapshots.push(createItems);
    for (const event of itemEvents) {
      const items = this.readAuditItems(event.newValues);
      if (items) snapshots.push(items);
    }

    const productIds = [...new Set(snapshots.flat().map((item) => item.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const productNames = new Map(products.map((product) => [product.id, product.name]));

    const totalVersions = refreshEvents.length + 1;
    const versions = [
      {
        version: 1,
        receiptType: 'INITIAL',
        status: totalVersions === 1 ? 'ACTIVE' : 'REPLACED',
        generatedAt: order.openedAt.toISOString(),
        summary: 'Creación inicial',
        previousTotal: null as number | null,
        newTotal: refreshEvents[0]
          ? this.readAuditNumber(refreshEvents[0].oldValues, 'previousTotal')
          : Number(order.subtotal),
      },
      ...refreshEvents.map((event, index) => {
        const values = this.readAuditJsonObject(event.newValues);
        const previous = this.readAuditJsonObject(event.oldValues);
        const before = snapshots[index];
        const after = snapshots[index + 1];
        return {
          version: index + 2,
          receiptType: 'UPDATED',
          status: index + 2 === totalVersions ? 'ACTIVE' : 'REPLACED',
          generatedAt: event.createdAt.toISOString(),
          summary: this.describeItemsDiff(before, after, productNames) ?? 'Cambio comercial del pedido',
          previousTotal: this.readAuditNumber(previous, 'previousTotal'),
          newTotal: this.readAuditNumber(values, 'newTotal'),
        };
      }),
    ];

    return { orderId: order.id, orderNumber: order.number, currentVersion: totalVersions, versions };
  }

  private readAuditItems(value: Prisma.JsonValue | null | undefined) {
    const record = this.readAuditJsonObject(value);
    if (!Array.isArray(record.items)) return null;
    const items: Array<{ productId: string; quantity: number }> = [];
    for (const raw of record.items) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const entry = raw as Record<string, unknown>;
        if (typeof entry.productId === 'string') {
          items.push({ productId: entry.productId, quantity: Number(entry.quantity ?? 0) });
        }
      }
    }
    return items;
  }

  private readAuditNumber(value: Prisma.JsonValue | Record<string, unknown> | null | undefined, key: string) {
    const record =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const raw = record[key];
    return raw == null || Number.isNaN(Number(raw)) ? null : Number(raw);
  }

  private describeItemsDiff(
    before: Array<{ productId: string; quantity: number }> | undefined,
    after: Array<{ productId: string; quantity: number }> | undefined,
    productNames: Map<string, string>,
  ) {
    if (!before || !after) return null;
    const totals = (list: Array<{ productId: string; quantity: number }>) => {
      const map = new Map<string, number>();
      for (const item of list) map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
      return map;
    };
    const beforeMap = totals(before);
    const afterMap = totals(after);
    const parts: string[] = [];
    for (const [productId, quantity] of afterMap) {
      const previous = beforeMap.get(productId) ?? 0;
      if (quantity > previous) {
        parts.push(`+${quantity - previous} ${productNames.get(productId) ?? 'producto'}`);
      }
    }
    for (const [productId, quantity] of beforeMap) {
      const next = afterMap.get(productId) ?? 0;
      if (next < quantity) {
        parts.push(`-${quantity - next} ${productNames.get(productId) ?? 'producto'}`);
      }
    }
    return parts.length ? parts.join(', ') : null;
  }

  async create(dto: CreateOrderTicketDto, actor: AuthUser) {
    const session = await this.getCurrentCashSession();
    const type = (dto.type as OrderTicketType | undefined) ?? OrderTicketType.COUNTER;
    if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
      if (type !== OrderTicketType.DINE_IN) {
        throw new BadRequestException('Meseros solo pueden crear comandas de mesa.');
      }
      await this.tablesService.assertWaiterCanOperateTable(actor, dto.tableId);
    }
    const assignToWaiter = actor.roles.includes('waiter') ? this.getWaiterAssignmentSnapshot(actor) : {};

    let order: Awaited<ReturnType<typeof this.prisma.orderTicket.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        order = await this.prisma.$transaction(async (tx) => {
          const table = await this.resolveTableForOrder(tx, dto.tableId, type);
          if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
            await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
          }
          const items = await this.buildOrderItems(tx, dto.items);
          const itemsSubtotal = items.reduce((acc, item) => acc.add(item.totalPrice), new Prisma.Decimal(0));
          const deliverySnapshot =
            type === OrderTicketType.DELIVERY
              ? await this.resolveDeliverySnapshot(tx, {
                  customerName: dto.customerName,
                  customerPhone: dto.customerPhone,
                  deliveryReference: dto.deliveryReference,
                  latitude: dto.deliveryLatitude,
                  longitude: dto.deliveryLongitude,
                  locationProvider: dto.deliveryLocationProvider,
                  locationPlaceId: dto.deliveryLocationPlaceId,
                  locationFormattedAddress: dto.deliveryLocationFormattedAddress,
                  locationConfidence: dto.deliveryLocationConfidence,
                  locationSource: dto.deliveryLocationProvider,
                })
              : null;
          const subtotal = itemsSubtotal.add(deliverySnapshot?.deliveryFee ?? new Prisma.Decimal(0));

          const created = await tx.orderTicket.create({
            data: {
              number: await this.generateOrderNumber(tx, type),
              type,
              tableId: table?.id,
              customerName: dto.customerName?.trim() || null,
              customerPhone: dto.customerPhone?.trim() || null,
              deliveryReference: dto.deliveryReference?.trim() || null,
              deliveryAddressNormalized: deliverySnapshot?.deliveryAddressNormalized ?? null,
              deliveryLatitude: deliverySnapshot?.deliveryLatitude ?? null,
              deliveryLongitude: deliverySnapshot?.deliveryLongitude ?? null,
              deliveryDistanceKm: deliverySnapshot?.deliveryDistanceKm ?? null,
              deliveryZoneLabel: deliverySnapshot?.deliveryZoneLabel ?? null,
              deliveryFee: deliverySnapshot?.deliveryFee ?? undefined,
              deliveryFeeSuggested: deliverySnapshot?.deliveryFeeSuggested ?? null,
              deliveryFeeEdited: deliverySnapshot?.deliveryFeeEdited ?? false,
              deliveryFeeEditReason: deliverySnapshot?.deliveryFeeEditReason ?? null,
              deliveryPricingStatus: deliverySnapshot?.deliveryPricingStatus ?? null,
              deliveryPricingConfidence: deliverySnapshot?.deliveryPricingConfidence ?? null,
              deliveryPricingBreakdown: deliverySnapshot?.deliveryPricingBreakdown ?? Prisma.JsonNull,
              deliveryCalculationVersion: deliverySnapshot?.deliveryCalculationVersion ?? null,
              deliveryRequiresManualQuote: deliverySnapshot?.deliveryRequiresManualQuote ?? false,
              deliveryRouteProvider: deliverySnapshot?.deliveryRouteProvider ?? null,
              deliveryWeatherProvider: deliverySnapshot?.deliveryWeatherProvider ?? null,
              deliveryGeocodingProvider: deliverySnapshot?.deliveryGeocodingProvider ?? null,
              deliveryEstimatedMinutes: deliverySnapshot?.deliveryEstimatedMinutes ?? null,
              deliveryLocationSource: deliverySnapshot?.deliveryLocationSource ?? null,
              deliveryLocationReceivedAt: deliverySnapshot?.deliveryLocationReceivedAt ?? null,
              deliveryCustomerId: deliverySnapshot?.deliveryCustomerId ?? null,
              deliveryWorkflowStatus:
                type === OrderTicketType.DELIVERY
                  ? DeliveryWorkflowStatus.PENDING_ASSIGNMENT
                  : null,
              deliveryStatusUpdatedAt:
                type === OrderTicketType.DELIVERY ? new Date() : null,
              notes: dto.notes?.trim() || null,
              subtotal,
              cashSessionId: session.id,
              createdById: actor.sub,
              ...assignToWaiter,
              items: {
                create: items,
              },
            },
            include: orderInclude,
          });

          if (table) {
            await tx.diningTable.update({
              where: { id: table.id },
              data: { status: DiningTableStatus.OCCUPIED },
            });
          }

          if (deliverySnapshot?.deliveryPricingAuditId) {
            await tx.deliveryPricingAudit.updateMany({
              where: { id: deliverySnapshot.deliveryPricingAuditId, orderTicketId: null },
              data: { orderTicketId: created.id },
            });
          }

          return created;
        });
        break;
      } catch (error) {
        if (this.isOrderNumberConflict(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    if (!order) {
      throw new BadRequestException('No fue posible generar un consecutivo único para la comanda.');
    }

    await this.auditService.log({
      userId: actor.sub,
      action: 'CREATE',
      module: 'orders',
      entity: 'order_ticket',
      entityId: order.id,
      newValues: dto,
    });

    if (order.type === OrderTicketType.DELIVERY) {
      await this.createOperationalAlert({
        type: 'DELIVERY_CREATED',
        module: 'deliveries',
        severity: OperationalAlertSeverity.INFO,
        title: 'Nuevo domicilio abierto',
        message: `${order.number} quedó listo para asignación y seguimiento.`,
        entityType: 'order_ticket',
        entityId: order.id,
        actorId: actor.sub,
      });
    }

    this.realtimeService.publishOrderUpdated({
      entityId: order.id,
      orderType: order.type,
      status: order.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return order;
  }

  async update(id: string, dto: UpdateOrderTicketDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        table: true,
        createdBy: {
          select: {
            fullName: true,
          },
        },
        assignedWaiter: {
          select: {
            fullName: true,
          },
        },
        assignedRider: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (
      current.status === OrderTicketStatus.PAID ||
      current.status === OrderTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('Las comandas cerradas no se pueden modificar.');
    }

    const access = this.assertWaiterOrderWriteAccess(current, actor);
    if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
      if (current.type !== OrderTicketType.DINE_IN) {
        throw new BadRequestException('Meseros solo pueden guardar comandas de mesa.');
      }
      await this.tablesService.assertWaiterCanOperateTable(actor, current.tableId, this.prisma);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextType = (dto.type as OrderTicketType | undefined) ?? current.type;
      const nextTableId = dto.tableId === undefined ? current.tableId : dto.tableId || null;
      const table = await this.resolveTableForOrder(tx, nextTableId, nextType, current.id);
      if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
        if (nextType !== OrderTicketType.DINE_IN) {
          throw new BadRequestException('Meseros solo pueden guardar comandas de mesa.');
        }
        await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
      }
      const nextStatus = (dto.status as OrderTicketStatus | undefined) ?? current.status;
      const currentItems = await tx.orderTicketItem.findMany({
        where: { orderTicketId: id },
        select: { totalPrice: true },
      });
      const itemsSubtotal = currentItems.reduce((acc, item) => acc.add(item.totalPrice), new Prisma.Decimal(0));
      const deliverySnapshot =
        nextType === OrderTicketType.DELIVERY
          ? await this.resolveDeliverySnapshot(tx, {
              customerName: dto.customerName === undefined ? current.customerName : dto.customerName,
              customerPhone: dto.customerPhone === undefined ? current.customerPhone : dto.customerPhone,
              deliveryReference:
                dto.deliveryReference === undefined ? current.deliveryReference : dto.deliveryReference,
              latitude: dto.deliveryLatitude,
              longitude: dto.deliveryLongitude,
              locationProvider: dto.deliveryLocationProvider,
              locationPlaceId: dto.deliveryLocationPlaceId,
              locationFormattedAddress: dto.deliveryLocationFormattedAddress,
              locationConfidence: dto.deliveryLocationConfidence,
              locationSource: dto.deliveryLocationProvider,
              existing: current,
            })
          : null;
      const subtotal = itemsSubtotal.add(deliverySnapshot?.deliveryFee ?? new Prisma.Decimal(0));

      const result = await tx.orderTicket.updateMany({
        where: {
          id,
          ...(dto.expectedRevision === undefined ? {} : { revision: dto.expectedRevision }),
        },
        data: {
          type: nextType,
          status: nextStatus,
          tableId: table?.id ?? null,
          customerName: dto.customerName === undefined ? undefined : dto.customerName.trim() || null,
          customerPhone: dto.customerPhone === undefined ? undefined : dto.customerPhone.trim() || null,
          deliveryReference:
            dto.deliveryReference === undefined ? undefined : dto.deliveryReference.trim() || null,
          deliveryAddressNormalized: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryAddressNormalized ?? null : null,
          deliveryLatitude: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryLatitude ?? null : null,
          deliveryLongitude: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryLongitude ?? null : null,
          deliveryDistanceKm: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryDistanceKm ?? null : null,
          deliveryZoneLabel: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryZoneLabel ?? null : null,
          deliveryFee: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryFee ?? new Prisma.Decimal(0) : new Prisma.Decimal(0),
          deliveryFeeSuggested: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryFeeSuggested ?? null : null,
          deliveryFeeEdited: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryFeeEdited ?? false : false,
          deliveryFeeEditReason: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryFeeEditReason ?? null : null,
          deliveryPricingStatus: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryPricingStatus ?? null : null,
          deliveryPricingConfidence: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryPricingConfidence ?? null : null,
          deliveryPricingBreakdown: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryPricingBreakdown ?? Prisma.JsonNull : Prisma.JsonNull,
          deliveryCalculationVersion: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryCalculationVersion ?? null : null,
          deliveryRequiresManualQuote: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryRequiresManualQuote ?? false : false,
          deliveryRouteProvider: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryRouteProvider ?? null : null,
          deliveryWeatherProvider: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryWeatherProvider ?? null : null,
          deliveryGeocodingProvider: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryGeocodingProvider ?? null : null,
          deliveryEstimatedMinutes: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryEstimatedMinutes ?? null : null,
          deliveryLocationSource: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryLocationSource ?? null : null,
          deliveryLocationReceivedAt:
            nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryLocationReceivedAt ?? null : null,
          deliveryCustomerId: nextType === OrderTicketType.DELIVERY ? deliverySnapshot?.deliveryCustomerId ?? null : null,
          deliveryWorkflowStatus:
            nextType === OrderTicketType.DELIVERY
              ? nextStatus === OrderTicketStatus.CANCELLED
                ? DeliveryWorkflowStatus.ISSUE
                : current.type === OrderTicketType.DELIVERY
                ? current.deliveryWorkflowStatus ?? (current.assignedRiderId ? DeliveryWorkflowStatus.ASSIGNED : DeliveryWorkflowStatus.PENDING_ASSIGNMENT)
                : DeliveryWorkflowStatus.PENDING_ASSIGNMENT
              : null,
          deliveryStatusUpdatedAt:
            nextType === OrderTicketType.DELIVERY ? new Date() : null,
          assignedRiderId: nextType === OrderTicketType.DELIVERY ? current.assignedRiderId ?? null : null,
          assignedRiderAt: nextType === OrderTicketType.DELIVERY ? current.assignedRiderAt ?? null : null,
          deliveryDispatchedAt: nextType === OrderTicketType.DELIVERY ? current.deliveryDispatchedAt ?? null : null,
          deliveryDeliveredAt: nextType === OrderTicketType.DELIVERY ? current.deliveryDeliveredAt ?? null : null,
          deliveryIssueAt:
            nextType === OrderTicketType.DELIVERY
              ? nextStatus === OrderTicketStatus.CANCELLED
                ? current.deliveryIssueAt ?? new Date()
                : current.deliveryIssueAt ?? null
              : null,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          subtotal,
          servedAt:
            nextStatus === OrderTicketStatus.SERVED && !current.servedAt ? new Date() : undefined,
          cancelledAt:
            nextStatus === OrderTicketStatus.CANCELLED && !current.cancelledAt ? new Date() : undefined,
          ...(access.shouldAssign ? this.getWaiterAssignmentSnapshot(actor) : {}),
          revision: {
            increment: 1,
          },
        },
      });

      if (!result.count) {
        throw new ConflictException(
          'La comanda cambió mientras la estabas editando. Recárgala antes de guardar de nuevo.',
        );
      }

      if (deliverySnapshot?.deliveryPricingAuditId) {
        await tx.deliveryPricingAudit.updateMany({
          where: { id: deliverySnapshot.deliveryPricingAuditId, orderTicketId: null },
          data: { orderTicketId: id },
        });
      }

      if (current.tableId && current.tableId !== table?.id) {
        await tx.diningTable.update({
          where: { id: current.tableId },
          data: { status: DiningTableStatus.FREE },
        });
      }

      if (nextStatus === OrderTicketStatus.CANCELLED && (table?.id ?? current.tableId)) {
        await tx.diningTable.update({
          where: { id: table?.id ?? current.tableId! },
          data: { status: DiningTableStatus.FREE },
        });
      } else if (table) {
        await tx.diningTable.update({
          where: { id: table.id },
          data: {
            status:
              nextStatus === OrderTicketStatus.PAYMENT_PENDING
                ? DiningTableStatus.PAYMENT_PENDING
                : DiningTableStatus.OCCUPIED,
          },
        });
      }

      return tx.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
    });

    await this.auditService.log({
      userId: actor.sub,
      action: 'UPDATE',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      oldValues: current,
      newValues: dto,
    });

    this.realtimeService.publishOrderUpdated({
      entityId: updated.id,
      orderType: updated.type,
      status: updated.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return updated;
  }

  async replaceItems(id: string, dto: ReplaceOrderTicketItemsDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
        include: {
          createdBy: {
            select: {
              fullName: true,
            },
          },
          assignedWaiter: {
            select: {
              fullName: true,
            },
          },
        },
      });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (
      current.status === OrderTicketStatus.PAID ||
      current.status === OrderTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('Las comandas cerradas no se pueden modificar.');
    }

    const access = this.assertWaiterOrderWriteAccess(current, actor);
    if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
      if (current.type !== OrderTicketType.DINE_IN) {
        throw new BadRequestException('Meseros solo pueden guardar comandas de mesa.');
      }
      await this.tablesService.assertWaiterCanOperateTable(actor, current.tableId, this.prisma);
    }

    const updateResult = await this.prisma.$transaction(async (tx) => {
      const items = await this.buildOrderItems(tx, dto.items);
      const itemsSubtotal = items.reduce((acc, item) => acc.add(item.totalPrice), new Prisma.Decimal(0));
      const currentOrder = await tx.orderTicket.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          type: true,
          customerName: true,
          customerPhone: true,
          deliveryReference: true,
          deliveryCustomerId: true,
          deliveryWorkflowStatus: true,
          assignedRiderId: true,
          assignedRiderAt: true,
          deliveryDispatchedAt: true,
          deliveryDeliveredAt: true,
          deliveryIssueAt: true,
          deliveryLatitude: true,
          deliveryLongitude: true,
          deliveryLocationSource: true,
          deliveryLocationReceivedAt: true,
          deliveryAddressNormalized: true,
          deliveryDistanceKm: true,
          deliveryZoneLabel: true,
          deliveryFee: true,
          deliveryFeeSuggested: true,
          deliveryFeeEdited: true,
          deliveryFeeEditReason: true,
          deliveryPricingStatus: true,
          deliveryPricingConfidence: true,
          deliveryPricingBreakdown: true,
          deliveryCalculationVersion: true,
          deliveryRequiresManualQuote: true,
          deliveryRouteProvider: true,
          deliveryWeatherProvider: true,
          deliveryGeocodingProvider: true,
          deliveryEstimatedMinutes: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              notes: true,
            },
          },
        },
      });
      if (this.areCommercialItemsEqual(currentOrder.items, items)) {
        return {
          order: await tx.orderTicket.findUniqueOrThrow({
            where: { id },
            include: orderInclude,
          }),
          commercialChanged: false,
        };
      }

      const preservedDeliveryFee =
        currentOrder.type === OrderTicketType.DELIVERY
          ? new Prisma.Decimal(currentOrder.deliveryFee ?? 0)
          : new Prisma.Decimal(0);
      const subtotal = itemsSubtotal.add(preservedDeliveryFee);

      const result = await tx.orderTicket.updateMany({
        where: {
          id,
          ...(dto.expectedRevision === undefined ? {} : { revision: dto.expectedRevision }),
        },
        data: {
          subtotal,
          deliveryAddressNormalized:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryAddressNormalized ?? null : null,
          deliveryLatitude:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryLatitude ?? null : null,
          deliveryLongitude:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryLongitude ?? null : null,
          deliveryDistanceKm:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryDistanceKm ?? null : null,
          deliveryZoneLabel:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryZoneLabel ?? null : null,
          deliveryFee:
            currentOrder.type === OrderTicketType.DELIVERY ? preservedDeliveryFee : new Prisma.Decimal(0),
          deliveryFeeSuggested:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryFeeSuggested ?? null : null,
          deliveryFeeEdited:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryFeeEdited ?? false : false,
          deliveryFeeEditReason:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryFeeEditReason ?? null : null,
          deliveryPricingStatus:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryPricingStatus ?? null : null,
          deliveryPricingConfidence:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryPricingConfidence ?? null : null,
          deliveryPricingBreakdown:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryPricingBreakdown ?? Prisma.JsonNull : Prisma.JsonNull,
          deliveryCalculationVersion:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryCalculationVersion ?? null : null,
          deliveryRequiresManualQuote:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryRequiresManualQuote ?? false : false,
          deliveryRouteProvider:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryRouteProvider ?? null : null,
          deliveryWeatherProvider:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryWeatherProvider ?? null : null,
          deliveryGeocodingProvider:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryGeocodingProvider ?? null : null,
          deliveryEstimatedMinutes:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryEstimatedMinutes ?? null : null,
          deliveryLocationSource:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryLocationSource ?? null : null,
          deliveryLocationReceivedAt:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryLocationReceivedAt ?? null : null,
          deliveryCustomerId:
            currentOrder.type === OrderTicketType.DELIVERY ? currentOrder.deliveryCustomerId ?? null : null,
          deliveryWorkflowStatus:
            currentOrder.type === OrderTicketType.DELIVERY
              ? current.deliveryWorkflowStatus ?? (current.assignedRiderId ? DeliveryWorkflowStatus.ASSIGNED : DeliveryWorkflowStatus.PENDING_ASSIGNMENT)
              : null,
          deliveryStatusUpdatedAt:
            currentOrder.type === OrderTicketType.DELIVERY ? new Date() : null,
          ...(access.shouldAssign ? this.getWaiterAssignmentSnapshot(actor) : {}),
          revision: {
            increment: 1,
          },
        },
      });

      if (!result.count) {
        throw new ConflictException(
          'La comanda cambió mientras la estabas editando. Recárgala antes de guardar de nuevo.',
        );
      }

      await tx.orderTicketItem.deleteMany({
        where: { orderTicketId: id },
      });

      await tx.orderTicketItem.createMany({
        data: items.map((item) => ({
          orderTicketId: id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          notes: item.notes,
        })),
      });

      return {
        order: await tx.orderTicket.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        }),
        commercialChanged: true,
      };
    });
    const updated = updateResult.order;

    await this.auditService.log({
      userId: actor.sub,
      action: 'UPDATE_ITEMS',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      newValues: dto,
    });

    if (updated.type === OrderTicketType.DELIVERY && updateResult.commercialChanged) {
      /* El audit REFRESHED se registra antes de generar el PDF: la versión
         comercial se deriva contando estos eventos, así el PDF nuevo ya sale
         numerado como la versión que estrena. */
      const previousVersion = await this.getDeliveryCommercialVersion(updated.id);
      const newVersion = previousVersion + 1;
      await this.auditService.log({
        userId: actor.sub,
        action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: id,
        oldValues: {
          previousTotal: current.subtotal,
        },
        newValues: {
          newTotal: updated.subtotal,
          deliveryFee: updated.deliveryFee,
          receiptVersion: newVersion,
          receiptRegenerated: true,
          message: 'Pedido actualizado. Nueva cuenta generada con total vigente.',
        },
      });
      await this.auditService.log({
        userId: actor.sub,
        action: 'DELIVERY_RECEIPT_REPLACED',
        module: 'orders',
        entity: 'order_ticket',
        entityId: id,
        oldValues: {
          receiptVersion: previousVersion,
          status: 'REPLACED',
        },
        newValues: {
          receiptVersion: newVersion,
          status: 'ACTIVE',
          previousTotal: current.subtotal,
          newTotal: updated.subtotal,
        },
      });
      await this.generateDeliveryReceiptPdf(updated.id, { updated: true, actorId: actor.sub });
      await this.sendUpdatedDeliveryReceiptAfterCommercialChange({
        order: updated,
        actorId: actor.sub,
        previousTotal: current.subtotal,
      });
    }

    this.realtimeService.publishOrderUpdated({
      entityId: updated.id,
      orderType: updated.type,
      status: updated.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return updated;
  }

  async syncWaiterOrder(dto: SyncWaiterOrderDto, actor: AuthUser) {
    const cachedReceipt = await this.prisma.waiterOrderSyncReceipt.findUnique({
      where: { clientMutationId: dto.clientMutationId },
      include: {
        orderTicket: {
          include: orderInclude,
        },
      },
    });

    if (cachedReceipt) {
      if (cachedReceipt.userId !== actor.sub) {
        throw new ConflictException('La operación pendiente pertenece a otra sesión.');
      }

      return cachedReceipt.orderTicket;
    }

    const session = await this.getCurrentCashSession();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingReceipt = await tx.waiterOrderSyncReceipt.findUnique({
          where: { clientMutationId: dto.clientMutationId },
          include: {
            orderTicket: {
              include: orderInclude,
            },
          },
        });

        if (existingReceipt) {
          if (existingReceipt.userId !== actor.sub) {
            throw new ConflictException('La operación pendiente pertenece a otra sesión.');
          }

          return { order: existingReceipt.orderTicket, action: 'SYNC_IDEMPOTENT' as const };
        }

        let current = dto.orderId
          ? await tx.orderTicket.findUnique({
              where: { id: dto.orderId },
              include: {
                table: true,
                createdBy: {
                  select: {
                    fullName: true,
                  },
                },
                assignedWaiter: {
                  select: {
                    fullName: true,
                  },
                },
              },
            })
          : null;

        if (!current) {
          current = await tx.orderTicket.findFirst({
            where: {
              tableId: dto.tableId,
              status: {
                in: ACTIVE_ORDER_STATUSES,
              },
            },
            include: {
              table: true,
              createdBy: {
                select: {
                  fullName: true,
                },
              },
              assignedWaiter: {
                select: {
                  fullName: true,
                },
              },
            },
            orderBy: { openedAt: 'desc' },
          });
        }

        const items = await this.buildOrderItems(tx, dto.items);
        const subtotal = items.reduce((acc, item) => acc.add(item.totalPrice), new Prisma.Decimal(0));

        if (current) {
          if (
            current.status === OrderTicketStatus.PAID ||
            current.status === OrderTicketStatus.CANCELLED
          ) {
            throw new BadRequestException('Las comandas cerradas no se pueden modificar.');
          }

          const access = this.assertWaiterOrderWriteAccess(current, actor, {
            allowClaim: dto.takeOwnership === true,
          });
          const table = await this.resolveTableForOrder(tx, dto.tableId, OrderTicketType.DINE_IN, current.id);
          await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
          const nextStatus = (dto.status as OrderTicketStatus | undefined) ?? current.status;

          const result = await tx.orderTicket.updateMany({
            where: {
              id: current.id,
              ...(dto.expectedRevision === undefined ? {} : { revision: dto.expectedRevision }),
            },
            data: {
              type: OrderTicketType.DINE_IN,
              status: nextStatus,
              tableId: table?.id ?? null,
              customerName: dto.customerName?.trim() || null,
              customerPhone: dto.customerPhone?.trim() || null,
              notes: dto.notes?.trim() || null,
              subtotal,
              servedAt:
                nextStatus === OrderTicketStatus.SERVED && !current.servedAt ? new Date() : undefined,
              ...(access.shouldAssign ? this.getWaiterAssignmentSnapshot(actor) : {}),
              revision: {
                increment: 1,
              },
            },
          });

          if (!result.count) {
            throw new ConflictException(
              'La comanda cambió mientras la estabas editando. Recárgala antes de guardar de nuevo.',
            );
          }

          await tx.orderTicketItem.deleteMany({
            where: { orderTicketId: current.id },
          });

          await tx.orderTicketItem.createMany({
            data: items.map((item) => ({
              orderTicketId: current!.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              notes: item.notes,
            })),
          });

          const order = await tx.orderTicket.findUniqueOrThrow({
            where: { id: current.id },
            include: orderInclude,
          });

          await tx.waiterOrderSyncReceipt.create({
            data: {
              clientMutationId: dto.clientMutationId,
              userId: actor.sub,
              orderTicketId: order.id,
            },
          });

          return {
            order,
            action: access.shouldAssign ? ('WAITER_SYNC_CLAIM' as const) : ('WAITER_SYNC_UPDATE' as const),
          };
        }

        const table = await this.resolveTableForOrder(tx, dto.tableId, OrderTicketType.DINE_IN);
        await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
        const order = await tx.orderTicket.create({
          data: {
            number: await this.generateOrderNumber(tx, OrderTicketType.DINE_IN),
            type: OrderTicketType.DINE_IN,
            status: (dto.status as OrderTicketStatus | undefined) ?? OrderTicketStatus.OPEN,
            tableId: table?.id,
            customerName: dto.customerName?.trim() || null,
            customerPhone: dto.customerPhone?.trim() || null,
            notes: dto.notes?.trim() || null,
            subtotal,
            cashSessionId: session.id,
            createdById: actor.sub,
            ...this.getWaiterAssignmentSnapshot(actor),
            items: {
              create: items,
            },
          },
          include: orderInclude,
        });

        if (table) {
          await tx.diningTable.update({
            where: { id: table.id },
            data: { status: DiningTableStatus.OCCUPIED },
          });
        }

        await tx.waiterOrderSyncReceipt.create({
          data: {
            clientMutationId: dto.clientMutationId,
            userId: actor.sub,
            orderTicketId: order.id,
          },
        });

        return { order, action: 'WAITER_SYNC_CREATE' as const };
      });

    await this.auditService.log({
      userId: actor.sub,
      action: result.action,
        module: 'orders',
        entity: 'order_ticket',
        entityId: result.order.id,
        newValues: {
          tableId: dto.tableId,
          itemCount: dto.items.length,
          status: dto.status ?? 'OPEN',
          clientMutationId: dto.clientMutationId,
        },
      });

      if (actor.roles.includes('waiter')) {
        await this.createOperationalAlert({
          type:
            result.order.status === OrderTicketStatus.PAYMENT_PENDING
              ? 'WAITER_ORDER_READY_FOR_PAYMENT'
              : result.action === 'WAITER_SYNC_CREATE'
                ? 'WAITER_ORDER_CREATED'
                : 'WAITER_ORDER_UPDATED',
          module: 'waiters',
          severity:
            result.order.status === OrderTicketStatus.PAYMENT_PENDING
              ? OperationalAlertSeverity.WARNING
              : OperationalAlertSeverity.INFO,
          title:
            result.order.status === OrderTicketStatus.PAYMENT_PENDING
              ? 'Comanda lista para cobro'
              : result.action === 'WAITER_SYNC_CREATE'
                ? 'Nueva comanda tomada'
                : 'Comanda actualizada',
          message:
            result.order.status === OrderTicketStatus.PAYMENT_PENDING
              ? `${result.order.number} quedó lista para cobro desde meseros.`
              : result.action === 'WAITER_SYNC_CREATE'
                ? `${result.order.number} quedó abierta desde el panel de meseros.`
                : `${result.order.number} registró cambios desde el panel de meseros.`,
          entityType: 'order_ticket',
          entityId: result.order.id,
          actorId: actor.sub,
          metadata: {
            action: result.action,
            orderStatus: result.order.status,
            tableId: dto.tableId,
          },
        });
      }

      this.realtimeService.publishOrderUpdated({
        entityId: result.order.id,
        orderType: result.order.type,
        status: result.order.status,
        actorId: actor.sub,
      });
      this.realtimeService.publishOperationalRefresh('all');
      return result.order;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('client_mutation_id')
      ) {
        const receipt = await this.prisma.waiterOrderSyncReceipt.findUniqueOrThrow({
          where: { clientMutationId: dto.clientMutationId },
          include: {
            orderTicket: {
              include: orderInclude,
            },
          },
        });
        return receipt.orderTicket;
      }

      throw error;
    }
  }

  async claim(id: string, dto: ClaimOrderTicketDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            fullName: true,
          },
        },
        assignedWaiter: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (
      current.status === OrderTicketStatus.PAID ||
      current.status === OrderTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('Las comandas cerradas no se pueden reclamar.');
    }

    if (current.assignedWaiterId && current.assignedWaiterId !== actor.sub) {
      throw new ConflictException(`La comanda la atiende ${this.getEffectiveOrderOwnerName(current)}.`);
    }

    if (current.assignedWaiterId === actor.sub) {
      return this.prisma.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
    }

    if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
      if (current.type !== OrderTicketType.DINE_IN) {
        throw new BadRequestException('Meseros solo pueden reclamar comandas de mesa.');
      }
      await this.tablesService.assertWaiterCanOperateTable(actor, current.tableId, this.prisma);
    }

    const claimed = await this.prisma.orderTicket.update({
      where: { id },
      data: {
        ...this.getWaiterAssignmentSnapshot(actor),
        revision: {
          increment: 1,
        },
      },
      include: orderInclude,
    });

    await this.auditService.log({
      userId: actor.sub,
      action: 'CLAIM',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      oldValues: {
        assignedWaiterId: current.assignedWaiterId,
      },
      newValues: {
        assignedWaiterId: actor.sub,
        reason: dto.reason?.trim() || null,
      },
    });

    await this.createOperationalAlert({
      type: 'WAITER_ORDER_CLAIMED',
      module: 'waiters',
      severity: OperationalAlertSeverity.INFO,
      title: 'Comanda reasignada',
      message: `${claimed.number} quedó a cargo de ${actor.fullName}.`,
      entityType: 'order_ticket',
      entityId: claimed.id,
      actorId: actor.sub,
      metadata: {
        previousWaiterId: current.assignedWaiterId,
        currentWaiterId: actor.sub,
      },
    });

    this.realtimeService.publishOrderUpdated({
      entityId: claimed.id,
      orderType: claimed.type,
      status: claimed.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');
    return claimed;
  }

  async assignDeliveryRider(id: string, dto: AssignDeliveryRiderDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        assignedRider: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    this.assertDeliveryOrder(current);

    const rider = await this.prisma.user.findUnique({
      where: { id: dto.riderId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!rider || !rider.isActive || !rider.roles.some(({ role }) => role.name === 'delivery')) {
      throw new BadRequestException('Selecciona un domiciliario activo y válido.');
    }

    const assigned = await this.prisma.orderTicket.update({
      where: { id },
      data: {
        assignedRiderId: rider.id,
        assignedRiderAt: new Date(),
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
        deliveryStatusUpdatedAt: new Date(),
        deliveryDispatchedAt: null,
        deliveryDeliveredAt: null,
        deliveryIssueAt: null,
        revision: {
          increment: 1,
        },
      },
      include: orderInclude,
    });

    await this.auditService.log({
      userId: actor.sub,
      action: 'ASSIGN_DELIVERY_RIDER',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      oldValues: {
        assignedRiderId: current.assignedRiderId,
        assignedRiderName: current.assignedRider?.fullName ?? null,
      },
      newValues: {
        assignedRiderId: rider.id,
        assignedRiderName: rider.fullName,
        notes: dto.notes?.trim() || null,
      },
    });

    await this.createOperationalAlert({
      type: 'DELIVERY_ASSIGNED',
      module: 'deliveries',
      severity: OperationalAlertSeverity.INFO,
      title: 'Domicilio asignado',
      message: `${assigned.number} fue asignado a ${assigned.assignedRider?.fullName ?? 'un domiciliario'}.`,
      entityType: 'order_ticket',
      entityId: assigned.id,
      actorId: actor.sub,
      metadata: {
        riderId: assigned.assignedRiderId,
        riderName: assigned.assignedRider?.fullName ?? null,
      },
    });
    this.realtimeService.publishDeliveryWorkflowUpdated({
      entityId: assigned.id,
      workflowStatus: assigned.deliveryWorkflowStatus ?? DeliveryWorkflowStatus.ASSIGNED,
      actorId: actor.sub,
    });
    this.realtimeService.publishOrderUpdated({
      entityId: assigned.id,
      orderType: assigned.type,
      status: assigned.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');
    return assigned;
  }

  async claimDelivery(id: string, dto: ClaimOrderTicketDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        assignedRider: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    this.assertDeliveryOrder(current);
    const access = this.assertDeliveryWorkflowAccess(current, actor, {
      allowClaim: true,
    });

    if (current.assignedRiderId === actor.sub) {
      return this.prisma.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
    }

    if (!access.shouldAssignToActor) {
      throw new ConflictException(
        current.assignedRider?.fullName
          ? `El domicilio ya está asignado a ${current.assignedRider.fullName}.`
          : 'El domicilio ya está asignado a otro domiciliario.',
      );
    }

    return this.assignDeliveryRider(
      id,
      {
        riderId: actor.sub,
        notes: dto.reason?.trim() || undefined,
      },
      actor,
    );
  }

  async updateDeliveryWorkflow(id: string, dto: UpdateDeliveryWorkflowDto, actor: AuthUser) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        assignedRider: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    this.assertDeliveryOrder(current);
    const access = this.assertDeliveryWorkflowAccess(current, actor, {
      allowClaim: dto.workflowStatus === 'ASSIGNED',
    });

    const nextStatus = dto.workflowStatus as DeliveryWorkflowStatus;
    if (
      (nextStatus === DeliveryWorkflowStatus.IN_TRANSIT ||
        nextStatus === DeliveryWorkflowStatus.DELIVERED ||
        nextStatus === DeliveryWorkflowStatus.ISSUE) &&
      !current.assignedRiderId &&
      !access.shouldAssignToActor &&
      !this.isPrivilegedOrderOperator(actor)
    ) {
      throw new ConflictException('Asigna un domiciliario antes de cambiar el estado del reparto.');
    }

    const updated = await this.prisma.orderTicket.update({
      where: { id },
      data: {
        assignedRiderId: access.shouldAssignToActor ? actor.sub : current.assignedRiderId,
        assignedRiderAt:
          access.shouldAssignToActor || (nextStatus === DeliveryWorkflowStatus.ASSIGNED && !current.assignedRiderAt)
            ? new Date()
            : current.assignedRiderAt,
        deliveryWorkflowStatus: nextStatus,
        deliveryStatusUpdatedAt: new Date(),
        deliveryDispatchedAt:
          nextStatus === DeliveryWorkflowStatus.IN_TRANSIT
            ? current.deliveryDispatchedAt ?? new Date()
            : nextStatus === DeliveryWorkflowStatus.PENDING_ASSIGNMENT || nextStatus === DeliveryWorkflowStatus.ASSIGNED
              ? null
              : current.deliveryDispatchedAt,
        deliveryDeliveredAt:
          nextStatus === DeliveryWorkflowStatus.DELIVERED
            ? current.deliveryDeliveredAt ?? new Date()
            : nextStatus === DeliveryWorkflowStatus.PENDING_ASSIGNMENT ||
                nextStatus === DeliveryWorkflowStatus.ASSIGNED ||
                nextStatus === DeliveryWorkflowStatus.IN_TRANSIT
              ? null
              : current.deliveryDeliveredAt,
        deliveryIssueAt:
          nextStatus === DeliveryWorkflowStatus.ISSUE
            ? new Date()
            : nextStatus === DeliveryWorkflowStatus.PENDING_ASSIGNMENT ||
                nextStatus === DeliveryWorkflowStatus.ASSIGNED ||
                nextStatus === DeliveryWorkflowStatus.IN_TRANSIT ||
                nextStatus === DeliveryWorkflowStatus.DELIVERED
              ? null
              : current.deliveryIssueAt,
        status:
          nextStatus === DeliveryWorkflowStatus.DELIVERED &&
          current.status !== OrderTicketStatus.PAID &&
          current.status !== OrderTicketStatus.CANCELLED
            ? OrderTicketStatus.PAYMENT_PENDING
            : current.status,
        notes:
          dto.notes === undefined
            ? undefined
            : [current.notes, dto.notes.trim()].filter(Boolean).join('\n') || null,
        revision: {
          increment: 1,
        },
      },
      include: orderInclude,
    });

    let deliveryIssueId: string | null = null;
    if (nextStatus === DeliveryWorkflowStatus.ISSUE) {
      const issueType = (dto.issueType as DeliveryIssueType | undefined) ?? DeliveryIssueType.OTHER;
      const issue = await this.prisma.deliveryIssue.create({
        data: {
          orderTicketId: id,
          issueType,
          summary: this.buildDeliveryIssueSummary(issueType, dto.notes),
          details: dto.notes?.trim() || null,
          reportedById: actor.sub,
        },
      });
      deliveryIssueId = issue.id;
    }

    if (nextStatus === DeliveryWorkflowStatus.DELIVERED) {
      await this.prisma.deliveryIssue.updateMany({
        where: {
          orderTicketId: id,
          status: DeliveryIssueStatus.OPEN,
        },
        data: {
          status: DeliveryIssueStatus.RESOLVED,
          resolvedById: actor.sub,
          resolvedAt: new Date(),
        },
      });
    }

    await this.auditService.log({
      userId: actor.sub,
      action: 'UPDATE_DELIVERY_WORKFLOW',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      oldValues: {
        deliveryWorkflowStatus: current.deliveryWorkflowStatus,
        assignedRiderId: current.assignedRiderId,
      },
      newValues: {
        status: updated.status,
        deliveryWorkflowStatus: nextStatus,
        assignedRiderId: updated.assignedRiderId,
        notes: dto.notes?.trim() || null,
      },
    });

    await this.createOperationalAlert({
      type:
        nextStatus === DeliveryWorkflowStatus.IN_TRANSIT
          ? 'DELIVERY_IN_TRANSIT'
          : nextStatus === DeliveryWorkflowStatus.DELIVERED
            ? 'DELIVERY_DELIVERED'
            : nextStatus === DeliveryWorkflowStatus.ISSUE
              ? 'DELIVERY_ISSUE'
              : 'DELIVERY_WORKFLOW_UPDATED',
      module: 'deliveries',
      severity:
        nextStatus === DeliveryWorkflowStatus.ISSUE
          ? OperationalAlertSeverity.CRITICAL
          : OperationalAlertSeverity.INFO,
      title:
        nextStatus === DeliveryWorkflowStatus.IN_TRANSIT
          ? 'Domicilio en camino'
          : nextStatus === DeliveryWorkflowStatus.DELIVERED
            ? 'Domicilio entregado'
            : nextStatus === DeliveryWorkflowStatus.ISSUE
              ? 'Domicilio con novedad'
              : 'Flujo de delivery actualizado',
      message:
        nextStatus === DeliveryWorkflowStatus.IN_TRANSIT
          ? `${updated.number} salió a entrega.`
          : nextStatus === DeliveryWorkflowStatus.DELIVERED
            ? `${updated.number} fue marcado como entregado.`
            : nextStatus === DeliveryWorkflowStatus.ISSUE
              ? `${updated.number} quedó con una novedad operativa.`
              : `${updated.number} actualizó su estado de reparto.`,
      entityType: 'order_ticket',
      entityId: updated.id,
      actorId: actor.sub,
      deliveryIssueId,
      metadata: {
        workflowStatus: nextStatus,
        notes: dto.notes?.trim() || null,
        issueType: dto.issueType ?? null,
      },
    });

    if (nextStatus === DeliveryWorkflowStatus.DELIVERED) {
      await this.resolveOperationalAlerts({
        module: 'deliveries',
        entityType: 'order_ticket',
        entityId: updated.id,
        types: ['DELIVERY_ISSUE', 'DELIVERY_LOCATION_RECEIVED', 'DELIVERY_ASSIGNED', 'DELIVERY_IN_TRANSIT'],
        resolvedById: actor.sub,
      });
    }

    this.realtimeService.publishDeliveryWorkflowUpdated({
      entityId: updated.id,
      workflowStatus: nextStatus,
      actorId: actor.sub,
    });
    this.realtimeService.publishOrderUpdated({
      entityId: updated.id,
      orderType: updated.type,
      status: updated.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');
    return updated;
  }

  async checkout(id: string, dto: CheckoutOrderTicketDto, actorId: string) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        table: true,
        items: true,
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (
      current.status === OrderTicketStatus.PAID ||
      current.status === OrderTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('La comanda ya está cerrada.');
    }

    if (!current.items.length) {
      throw new BadRequestException('La comanda no tiene productos.');
    }

    const session = await this.prisma.cashSession.findFirst({
      where: {
        id: current.cashSessionId,
        status: CashSessionStatus.OPEN,
      },
    });

    if (!session) {
      throw new BadRequestException('La sesión de caja asociada a esta comanda ya no está abierta.');
    }

    this.assertDeliveryCheckoutAllowed(current);

    const salePayload: CreateSaleDto = {
      baseSubtotal: dto.baseSubtotal,
      channel: this.mapOrderTypeToSaleChannel(current.type),
      tableLabel: current.table?.label ?? undefined,
      deliveryReference: current.deliveryReference ?? undefined,
      customerName: current.customerName ?? undefined,
      customerPhone: current.customerPhone ?? undefined,
      deliveryFee: toNumber(current.deliveryFee ?? 0),
      deliveryFeeSuggested: current.deliveryFeeSuggested != null ? toNumber(current.deliveryFeeSuggested) : undefined,
      deliveryFeeEdited: current.deliveryFeeEdited ?? false,
      deliveryFeeEditReason: current.deliveryFeeEditReason ?? undefined,
      deliveryDistanceKm: current.deliveryDistanceKm != null ? toNumber(current.deliveryDistanceKm) : undefined,
      deliveryZoneLabel: current.deliveryZoneLabel ?? undefined,
      deliveryPricingBreakdown: current.deliveryPricingBreakdown ?? undefined,
      deliveryCalculationVersion: current.deliveryCalculationVersion ?? undefined,
      notes: dto.notes?.trim() || current.notes || undefined,
      items: current.items.map((item) => ({
        productId: item.productId,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        notes: item.notes ?? undefined,
      })),
      payments: dto.payments,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const sale = await this.salesService.createInTransaction(tx, salePayload, actorId, session.id, {
        orderTicketId: current.id,
      });

      if (current.type === OrderTicketType.DELIVERY) {
        await tx.deliveryPricingAudit.updateMany({
          where: {
            orderTicketId: current.id,
            saleId: null,
          },
          data: {
            saleId: sale.id,
          },
        });
      }

      const updatedOrder = await tx.orderTicket.update({
        where: { id: current.id },
        data: {
          status: OrderTicketStatus.PAID,
          deliveryWorkflowStatus:
            current.type === OrderTicketType.DELIVERY
              ? DeliveryWorkflowStatus.DELIVERED
              : undefined,
          deliveryStatusUpdatedAt:
            current.type === OrderTicketType.DELIVERY ? new Date() : undefined,
          deliveryDeliveredAt:
            current.type === OrderTicketType.DELIVERY && !current.deliveryDeliveredAt
              ? new Date()
              : undefined,
          paidAt: new Date(),
          notes: dto.notes?.trim() || current.notes || null,
        },
        include: orderInclude,
      });

      if (current.tableId) {
        await tx.diningTable.update({
          where: { id: current.tableId },
          data: { status: DiningTableStatus.FREE },
        });
      }

      return {
        order: updatedOrder,
        sale,
      };
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CHECKOUT',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      newValues: {
        payments: dto.payments,
        saleId: result.sale.id,
      },
    });

    this.realtimeService.publishDeliveryWorkflowUpdated({
      entityId: result.order.id,
      workflowStatus: result.order.deliveryWorkflowStatus ?? DeliveryWorkflowStatus.DELIVERED,
      actorId,
    });
    await this.resolveOperationalAlerts({
      module: 'waiters',
      entityType: 'order_ticket',
      entityId: result.order.id,
      types: ['WAITER_ORDER_CREATED', 'WAITER_ORDER_UPDATED', 'WAITER_ORDER_READY_FOR_PAYMENT', 'WAITER_ORDER_CLAIMED'],
      resolvedById: actorId,
    });
    this.realtimeService.publishOrderUpdated({
      entityId: result.order.id,
      orderType: result.order.type,
      status: result.order.status,
      actorId,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return result;
  }

  private assertDeliveryCheckoutAllowed(order: {
    type: OrderTicketType;
    deliveryPricingStatus?: string | null;
    deliveryRequiresManualQuote?: boolean | null;
    deliveryFee?: Prisma.Decimal | number | null;
    deliveryPricingBreakdown?: Prisma.JsonValue | null;
    deliveryCalculationVersion?: string | null;
  }) {
    if (order.type !== OrderTicketType.DELIVERY) {
      return;
    }

    const status = order.deliveryPricingStatus;
    const canCheckout = status === 'LOCAL_FREE' || status === 'AUTO_PRICED';
    const fee = order.deliveryFee == null ? null : Number(order.deliveryFee);
    const hasCalculationSnapshot =
      Boolean(order.deliveryCalculationVersion?.trim()) &&
      order.deliveryPricingBreakdown != null;

    if (
      !canCheckout ||
      !hasCalculationSnapshot ||
      order.deliveryRequiresManualQuote ||
      fee == null ||
      !Number.isFinite(fee)
    ) {
      throw new BadRequestException('El domicilio requiere una tarifa automática válida antes de cobrar.');
    }
  }

  async reopen(id: string, dto: ReopenOrderTicketDto, actorId: string) {
    const reason = dto.reason.trim();

    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        table: true,
        sale: {
          include: {
            items: {
              include: {
                product: {
                  include: {
                    recipes: {
                      include: {
                        items: {
                          include: {
                            ingredient: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            payments: {
              include: {
                paymentMethod: true,
              },
            },
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (current.status !== OrderTicketStatus.PAID) {
      throw new BadRequestException('Solo una comanda ya cobrada se puede reabrir.');
    }

    if (!current.sale || current.sale.status !== SaleStatus.PAID) {
      throw new BadRequestException('La comanda no tiene una venta pagada activa para revertir.');
    }

    const currentSale = current.sale!;

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: {
          id: current.cashSessionId,
          status: CashSessionStatus.OPEN,
        },
      });

      if (!session) {
        throw new BadRequestException('La caja asociada a esta comanda ya no está abierta.');
      }

      if (current.type === OrderTicketType.DINE_IN && current.tableId) {
        await this.resolveTableForOrder(tx, current.tableId, current.type, current.id);
      }

      await this.restoreSaleStockForReopen(tx, currentSale.items, actorId, currentSale.id);

      await Promise.all(
        currentSale.payments.map((payment) =>
          tx.cashMovement.create({
            data: {
              cashSessionId: current.cashSessionId,
              type: CashMovementType.ADJUSTMENT,
              amount: payment.amount.neg(),
              paymentMethodId: payment.paymentMethodId,
              description: `Reversa por reapertura de ${current.number}`,
              referenceType: 'order_reopen',
              referenceId: current.id,
              classification: 'Reapertura de comanda',
              createdById: actorId,
            },
          }),
        ),
      );

      await tx.sale.update({
        where: { id: currentSale.id },
        data: {
          status: SaleStatus.CANCELLED,
          orderTicketId: null,
          notes: [currentSale.notes, `Reapertura de comanda: ${reason}`].filter(Boolean).join('\n'),
        },
      });

      const reopenedOrder = await tx.orderTicket.update({
        where: { id: current.id },
        data: {
          status: OrderTicketStatus.OPEN,
          deliveryWorkflowStatus:
            current.type === OrderTicketType.DELIVERY
              ? current.assignedRiderId
                ? DeliveryWorkflowStatus.ASSIGNED
                : DeliveryWorkflowStatus.PENDING_ASSIGNMENT
              : current.deliveryWorkflowStatus,
          deliveryStatusUpdatedAt:
            current.type === OrderTicketType.DELIVERY ? new Date() : current.deliveryStatusUpdatedAt,
          deliveryDeliveredAt: current.type === OrderTicketType.DELIVERY ? null : current.deliveryDeliveredAt,
          deliveryIssueAt: current.type === OrderTicketType.DELIVERY ? null : current.deliveryIssueAt,
          paidAt: null,
          cancelledAt: null,
          notes: [current.notes, `Reabierta: ${reason}`].filter(Boolean).join('\n'),
          revision: {
            increment: 1,
          },
        },
        include: orderInclude,
      });

      if (current.tableId) {
        await tx.diningTable.update({
          where: { id: current.tableId },
          data: { status: DiningTableStatus.OCCUPIED },
        });
      }

      return reopenedOrder;
    });

    await this.auditService.log({
      userId: actorId,
      action: 'REOPEN',
      module: 'orders',
      entity: 'order_ticket',
      entityId: id,
      oldValues: {
        status: current.status,
        saleId: currentSale.id,
        saleNumber: currentSale.number,
      },
      newValues: {
        status: result.status,
        reason,
      },
    });

    this.realtimeService.publishOrderUpdated({
      entityId: result.id,
      orderType: result.type,
      status: result.status,
      actorId,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return {
      success: true,
      orderTicket: result,
    };
  }

  private async getCurrentCashSession() {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException('Debes tener una caja abierta antes de gestionar comandas.');
    }

    return session;
  }

  private async resolveTableForOrder(
    tx: Prisma.TransactionClient,
    tableId: string | null | undefined,
    type: OrderTicketType,
    currentOrderId?: string,
  ) {
    if (type === OrderTicketType.DELIVERY && !tableId) {
      return null;
    }

    if (type !== OrderTicketType.DINE_IN) {
      if (tableId) {
        throw new BadRequestException('Solo las comandas en mesa se pueden asignar a una mesa.');
      }

      return null;
    }

    if (!tableId) {
      throw new BadRequestException('Las comandas en mesa requieren una mesa asignada.');
    }

    const table = await tx.diningTable.findUnique({
      where: { id: tableId },
      include: {
        orderTickets: {
          where: {
            status: {
              in: ACTIVE_ORDER_STATUSES,
            },
            ...(currentOrderId
              ? {
                  id: {
                    not: currentOrderId,
                  },
                }
              : {}),
          },
          take: 1,
        },
      },
    });

    if (!table || !table.isActive) {
      throw new NotFoundException('La mesa seleccionada no está disponible.');
    }

    if (table.status === DiningTableStatus.OUT_OF_SERVICE) {
      throw new BadRequestException('La mesa seleccionada está fuera de servicio.');
    }

    if (table.orderTickets.length) {
      throw new BadRequestException('La mesa seleccionada ya tiene una comanda activa.');
    }

    return table;
  }

  private async buildOrderItems(
    tx: Prisma.TransactionClient,
    items: Array<{ productId: string; quantity: number; unitPrice?: number; notes?: string }>,
  ) {
    const result: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
      notes?: string;
    }> = [];

    for (const item of items) {
      // BLOQUEO CONCURRENCIA: Bloquear producto antes de validar stock
      await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, item.productId);

      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });

      if (!product || !product.isActive) {
        throw new BadRequestException('Uno de los productos no está disponible.');
      }

      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice ?? product.salePrice);
      const totalPrice = quantity.mul(unitPrice);

      if (
        product.kind === ProductKind.DIRECT_STOCK &&
        product.trackStock &&
        product.currentStock.lessThan(quantity)
      ) {
        throw new BadRequestException(`Stock insuficiente para ${product.name}.`);
      }

      result.push({
        productId: product.id,
        quantity,
        unitPrice,
        totalPrice,
        notes: item.notes,
      });
    }

    return result;
  }

  private async applyDeliveryLocationForLogisticsOnly(
    order: {
      id: string;
      number: string;
      type: OrderTicketType;
      status: OrderTicketStatus;
      customerName: string | null;
      customerPhone: string | null;
      deliveryReference: string | null;
      deliveryCustomerId?: string | null;
      deliveryLatitude?: Prisma.Decimal | null;
      deliveryLongitude?: Prisma.Decimal | null;
      deliveryLocationSource?: string | null;
      deliveryLocationReceivedAt?: Date | null;
      deliveryAddressNormalized?: string | null;
      deliveryDistanceKm?: Prisma.Decimal | null;
      deliveryZoneLabel?: string | null;
      deliveryFee?: Prisma.Decimal | null;
      deliveryFeeSuggested?: Prisma.Decimal | null;
      deliveryFeeEdited?: boolean | null;
      deliveryFeeEditReason?: string | null;
      deliveryPricingStatus?: string | null;
      deliveryPricingConfidence?: string | null;
      deliveryPricingBreakdown?: Prisma.JsonValue | null;
      deliveryCalculationVersion?: string | null;
      deliveryRequiresManualQuote?: boolean | null;
      deliveryRouteProvider?: string | null;
      deliveryWeatherProvider?: string | null;
      deliveryGeocodingProvider?: string | null;
      deliveryEstimatedMinutes?: Prisma.Decimal | null;
      items: Array<{ totalPrice: Prisma.Decimal }>;
    },
    latitude: number,
    longitude: number,
    actorId?: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const normalizedPhone = this.normalizeDeliveryPhone(order.customerPhone);
      let deliveryCustomerId = order.deliveryCustomerId ?? null;
      if (normalizedPhone) {
        const deliveryCustomer = await tx.deliveryCustomer.upsert({
          where: { phone: normalizedPhone },
          update: {
            fullName: order.customerName?.trim() || undefined,
            defaultAddress: order.deliveryReference?.trim() || undefined,
            defaultReference: order.deliveryReference?.trim() || undefined,
            lastLatitude: new Prisma.Decimal(latitude),
            lastLongitude: new Prisma.Decimal(longitude),
            lastLocationAt: new Date(),
          },
          create: {
            phone: normalizedPhone,
            fullName: order.customerName?.trim() || null,
            defaultAddress: order.deliveryReference?.trim() || null,
            defaultReference: order.deliveryReference?.trim() || null,
            lastLatitude: new Prisma.Decimal(latitude),
            lastLongitude: new Prisma.Decimal(longitude),
            lastZoneLabel: order.deliveryZoneLabel ?? null,
            lastDistanceKm: order.deliveryDistanceKm ?? null,
            lastLocationAt: new Date(),
          },
        });
        deliveryCustomerId = deliveryCustomer.id;
      }

      return tx.orderTicket.update({
        where: { id: order.id },
        data: {
          deliveryLatitude: new Prisma.Decimal(latitude),
          deliveryLongitude: new Prisma.Decimal(longitude),
          deliveryLocationSource: 'whatsapp_live_location',
          deliveryLocationReceivedAt: new Date(),
          deliveryCustomerId,
          deliveryStatusUpdatedAt: new Date(),
          revision: {
            increment: 1,
          },
        },
        include: orderInclude,
      });
    });

    await this.auditService.log({
      userId: actorId || undefined,
      action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
      module: 'orders',
      entity: 'order_ticket',
      entityId: updated.id,
      newValues: {
        phoneMasked: this.maskPhoneForAudit(order.customerPhone),
        latitude,
        longitude,
        source: 'whatsapp_location',
        pricingPreserved: true,
        feeChanged: false,
        totalChanged: false,
        locationSavedForDelivery: true,
      },
    });

    await this.resolveOperationalAlerts({
      module: 'deliveries',
      entityType: 'order_ticket',
      entityId: updated.id,
      types: ['DELIVERY_LOCATION_PENDING_REVIEW'],
      resolvedById: actorId ?? null,
    });

    this.realtimeService.publishOrderUpdated({
      entityId: updated.id,
      orderType: updated.type,
      status: updated.status,
      actorId: actorId ?? null,
    });

    return updated;
  }

  async captureDeliveryLocationFromWhatsapp(input: {
    rawSenderJid?: string | null;
    participantJid?: string | null;
    remoteJid?: string | null;
    senderPhoneCandidates: string[];
    latitude: number;
    longitude: number;
    rawPayload?: Prisma.InputJsonValue | null;
    actorId?: string | null;
  }) {
    const normalizedCandidates = Array.from(
      new Set(input.senderPhoneCandidates.map((phone) => this.normalizeDeliveryPhone(phone)).filter(Boolean)),
    );

    const inbox = await this.prisma.deliveryLocationInbox.create({
      data: {
        rawSenderJid: input.rawSenderJid ?? null,
        participantJid: input.participantJid ?? null,
        remoteJid: input.remoteJid ?? null,
        normalizedSenderPhone: normalizedCandidates[0] ?? null,
        latitude: toDecimal(input.latitude),
        longitude: toDecimal(input.longitude),
        rawPayload: input.rawPayload ?? undefined,
      },
    });

    const activeDeliveryOrders = await this.prisma.orderTicket.findMany({
      where: {
        type: OrderTicketType.DELIVERY,
        status: {
          in: ACTIVE_ORDER_STATUSES,
        },
      },
      include: {
        items: {
          select: {
            totalPrice: true,
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    const matched = this.resolveDeliveryLocationMatch(activeDeliveryOrders, normalizedCandidates);

    if (!matched) {
      const unresolved = await this.prisma.deliveryLocationInbox.update({
        where: { id: inbox.id },
        data: {
          matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
          processingNotes: 'No fue posible correlacionar automáticamente la ubicación con una comanda activa.',
          processedAt: new Date(),
        },
      });

      const alert = await this.createOperationalAlert({
        type: 'DELIVERY_LOCATION_PENDING_REVIEW',
        module: 'deliveries',
        severity: OperationalAlertSeverity.WARNING,
        title: 'Ubicación pendiente de vincular',
        message: 'Llegó una ubicación de WhatsApp, pero el sistema no pudo determinar automáticamente a qué domicilio pertenece.',
        entityType: 'delivery_location_inbox',
        entityId: unresolved.id,
        actorId: input.actorId ?? null,
        deliveryLocationInboxId: unresolved.id,
        metadata: {
          remoteJid: input.remoteJid ?? null,
          normalizedSenderPhone: normalizedCandidates,
        },
      });

      this.realtimeService.publishDeliveryLocationPending({
        inboxId: unresolved.id,
        reason: 'manual_review_required',
        actorId: input.actorId ?? null,
      });
      this.realtimeService.publishOperationalRefresh('all');

      return {
        inbox: unresolved,
        order: null,
        alert,
        matchedRule: null,
      };
    }

    const updated = await this.applyDeliveryLocationForLogisticsOnly(
      matched.order!,
      input.latitude,
      input.longitude,
      input.actorId ?? undefined,
    );

    const appliedInbox = await this.prisma.deliveryLocationInbox.update({
      where: { id: inbox.id },
      data: {
        matchStatus: DeliveryLocationInboxStatus.APPLIED,
        matchedOrderId: updated.id,
        matchedCustomerId: updated.deliveryCustomerId ?? null,
        matchedRule: matched.rule,
        processingNotes: `Ubicación aplicada automáticamente a ${updated.number}.`,
        processedAt: new Date(),
      },
    });

    const infoAlert = await this.createOperationalAlert({
      type: 'DELIVERY_LOCATION_RECEIVED',
      module: 'deliveries',
      severity: OperationalAlertSeverity.INFO,
      title: 'Ubicación en vivo recibida',
      message: `El pedido ${updated.number} recibió ubicación para logística. Tarifa de domicilio conservada.`,
      entityType: 'order_ticket',
      entityId: updated.id,
      actorId: input.actorId ?? null,
      deliveryLocationInboxId: appliedInbox.id,
      metadata: {
        matchedRule: matched.rule,
        event: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
        source: 'whatsapp_location',
        pricingPreserved: true,
        feeChanged: false,
        totalChanged: false,
        locationSavedForDelivery: true,
      },
    });

    this.realtimeService.publishDeliveryLocationReceived({
      entityId: updated.id,
      inboxId: appliedInbox.id,
      actorId: input.actorId ?? null,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return {
      inbox: appliedInbox,
      order: updated,
      alert: infoAlert,
      matchedRule: matched.rule,
    };
  }

  async applyDeliveryLocationFromWhatsapp(phone: string, latitude: number, longitude: number, actorId?: string) {
    const result = await this.captureDeliveryLocationFromWhatsapp({
      senderPhoneCandidates: phone ? [phone] : [],
      latitude,
      longitude,
      actorId: actorId ?? null,
    });

    return result.order;
  }

  async findDeliveryLocationInbox(status?: DeliveryLocationInboxStatus) {
    const items = await this.prisma.deliveryLocationInbox.findMany({
      where: status ? { matchStatus: status } : undefined,
      include: {
        matchedOrder: {
          select: {
            id: true,
            number: true,
            customerName: true,
            customerPhone: true,
            updatedAt: true,
          },
        },
        matchedCustomer: {
          select: {
            id: true,
            fullName: true,
            phone: true,
          },
        },
      },
      orderBy: [{ matchStatus: 'asc' }, { receivedAt: 'desc' }],
      take: 50,
    });

    const activeOrders = await this.prisma.orderTicket.findMany({
      where: {
        type: OrderTicketType.DELIVERY,
        status: {
          in: ACTIVE_ORDER_STATUSES,
        },
      },
      select: {
        id: true,
        number: true,
        customerName: true,
        customerPhone: true,
        updatedAt: true,
      },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });

    return items.map((item) => {
      const normalizedPhone = item.normalizedSenderPhone ? this.normalizeDeliveryPhone(item.normalizedSenderPhone) : '';
      const candidateOrders = activeOrders.filter((order) => {
        const orderPhone = this.normalizeDeliveryPhone(order.customerPhone);
        if (!normalizedPhone) {
          return true;
        }

        return orderPhone === normalizedPhone || orderPhone.endsWith(normalizedPhone.slice(-10));
      });

      return {
        ...item,
        candidateOrders,
      };
    });
  }

  async resolveDeliveryLocationInbox(
    id: string,
    input: { orderId?: string; ignore?: boolean; notes?: string },
    actor: AuthUser,
  ) {
    const inbox = await this.prisma.deliveryLocationInbox.findUnique({
      where: { id },
    });

    if (!inbox) {
      throw new NotFoundException('No se encontró la ubicación pendiente.');
    }

    if (input.ignore) {
      const ignored = await this.prisma.deliveryLocationInbox.update({
        where: { id },
        data: {
          matchStatus: DeliveryLocationInboxStatus.IGNORED,
          processingNotes: input.notes?.trim() || 'Marcada como ignorada por operación.',
          processedAt: new Date(),
        },
      });

      await this.resolveOperationalAlerts({
        module: 'deliveries',
        entityType: 'delivery_location_inbox',
        entityId: ignored.id,
        types: ['DELIVERY_LOCATION_PENDING_REVIEW'],
        resolvedById: actor.sub,
      });

      this.realtimeService.publishOperationalRefresh('all');
      return ignored;
    }

    if (!input.orderId) {
      throw new BadRequestException('Selecciona una comanda para aplicar la ubicación pendiente.');
    }

    const order = await this.prisma.orderTicket.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          select: {
            totalPrice: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda seleccionada.');
    }

    this.assertDeliveryOrder(order);

    const updatedOrder = await this.applyDeliveryLocationForLogisticsOnly(
      order,
      Number(inbox.latitude),
      Number(inbox.longitude),
      actor.sub,
    );

    const resolvedInbox = await this.prisma.deliveryLocationInbox.update({
      where: { id },
      data: {
        matchStatus: DeliveryLocationInboxStatus.APPLIED,
        matchedOrderId: updatedOrder.id,
        matchedCustomerId: updatedOrder.deliveryCustomerId ?? null,
        matchedRule: 'manual_resolution',
        processingNotes: input.notes?.trim() || `Ubicación aplicada manualmente a ${updatedOrder.number}.`,
        processedAt: new Date(),
      },
    });

    await this.resolveOperationalAlerts({
      module: 'deliveries',
      entityType: 'delivery_location_inbox',
      entityId: resolvedInbox.id,
      types: ['DELIVERY_LOCATION_PENDING_REVIEW'],
      resolvedById: actor.sub,
    });

    await this.createOperationalAlert({
      type: 'DELIVERY_LOCATION_RECEIVED',
      module: 'deliveries',
      severity: OperationalAlertSeverity.INFO,
      title: 'Ubicación aplicada manualmente',
      message: `La ubicación pendiente quedó vinculada a ${updatedOrder.number}. Tarifa de domicilio conservada.`,
      entityType: 'order_ticket',
      entityId: updatedOrder.id,
      actorId: actor.sub,
      deliveryLocationInboxId: resolvedInbox.id,
      metadata: {
        event: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
        matchedRule: 'manual_resolution',
        source: 'whatsapp_location',
        pricingPreserved: true,
        feeChanged: false,
        totalChanged: false,
        locationSavedForDelivery: true,
      },
    });

    this.realtimeService.publishDeliveryLocationReceived({
      entityId: updatedOrder.id,
      inboxId: resolvedInbox.id,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');
    return {
      inbox: resolvedInbox,
      order: updatedOrder,
    };
  }

  async listOperationalAlerts(module?: string) {
    return this.prisma.operationalAlert.findMany({
      where: {
        ...(module ? { module } : {}),
        status: {
          in: [OperationalAlertStatus.OPEN, OperationalAlertStatus.ACKNOWLEDGED],
        },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async updateOperationalAlert(
    id: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED',
    actor: AuthUser,
    notes?: string,
  ) {
    const current = await this.prisma.operationalAlert.findUnique({
      where: { id },
    });

    if (!current) {
      throw new NotFoundException('No se encontró la alerta operativa.');
    }

    const currentMetadata =
      typeof current.metadata === 'object' && current.metadata && !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {};

    const updated = await this.prisma.operationalAlert.update({
      where: { id },
      data: {
        status,
        acknowledgedAt:
          status === OperationalAlertStatus.ACKNOWLEDGED ? current.acknowledgedAt ?? new Date() : current.acknowledgedAt,
        resolvedAt: status === OperationalAlertStatus.RESOLVED ? new Date() : current.resolvedAt,
        resolvedById: status === OperationalAlertStatus.RESOLVED ? actor.sub : current.resolvedById,
        metadata: notes?.trim() ? { ...currentMetadata, resolutionNotes: notes.trim() } : current.metadata ?? undefined,
      },
    });

    this.realtimeService.publishOperationalAlertUpdated({
      alertId: updated.id,
      module: updated.module,
      severity: updated.severity,
      status: updated.status,
      entityType: updated.entityType,
      entityId: updated.entityId,
    });
    this.realtimeService.publishOperationalRefresh('all');

    return updated;
  }

  private mapOrderTypeToSaleChannel(type: OrderTicketType): SaleChannel {
    switch (type) {
      case OrderTicketType.DINE_IN:
        return SaleChannel.MESA;
      case OrderTicketType.TAKEAWAY:
        return SaleChannel.PARA_LLEVAR;
      case OrderTicketType.DELIVERY:
        return SaleChannel.DOMICILIO;
      default:
        return SaleChannel.MOSTRADOR;
    }
  }

  private normalizeDeliveryPhone(phone: string | null | undefined) {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    if (digits.startsWith('57') && digits.length >= 12) {
      return digits;
    }

    if (digits.length === 10) {
      return `57${digits}`;
    }

    return digits;
  }

  private async resolveDeliverySnapshot(
    tx: Prisma.TransactionClient,
    input: {
      customerName?: string | null;
      customerPhone?: string | null;
      deliveryReference?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      locationSource?: string | null;
      locationProvider?: string | null;
      locationPlaceId?: string | null;
      locationFormattedAddress?: string | null;
      locationConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
      existing?: {
        deliveryCustomerId?: string | null;
        deliveryLatitude?: Prisma.Decimal | number | null;
        deliveryLongitude?: Prisma.Decimal | number | null;
        deliveryLocationSource?: string | null;
        deliveryLocationReceivedAt?: Date | string | null;
        deliveryReference?: string | null;
        deliveryAddressNormalized?: string | null;
        deliveryDistanceKm?: Prisma.Decimal | number | null;
        deliveryZoneLabel?: string | null;
        deliveryFee?: Prisma.Decimal | number | null;
        deliveryFeeSuggested?: Prisma.Decimal | number | null;
        deliveryFeeEdited?: boolean | null;
        deliveryFeeEditReason?: string | null;
        deliveryPricingStatus?: string | null;
        deliveryPricingConfidence?: string | null;
        deliveryPricingBreakdown?: Prisma.JsonValue | null;
        deliveryCalculationVersion?: string | null;
        deliveryRequiresManualQuote?: boolean | null;
        deliveryRouteProvider?: string | null;
        deliveryWeatherProvider?: string | null;
        deliveryGeocodingProvider?: string | null;
        deliveryEstimatedMinutes?: Prisma.Decimal | number | null;
      } | null;
    },
  ) {
    const normalizedPhone = this.normalizeDeliveryPhone(input.customerPhone);
    if (!normalizedPhone) {
      throw new BadRequestException('Los domicilios necesitan un número de teléfono válido.');
    }

    const rawReference = input.deliveryReference?.trim() || null;
    const normalizedAddress = rawReference ? normalizeAddrForCustomer(rawReference) : null;
    const existingAddress = input.existing?.deliveryAddressNormalized
      ? normalizeAddrForCustomer(input.existing.deliveryAddressNormalized)
      : null;
    const referenceChanged =
      normalizedAddress != null &&
      existingAddress != null &&
      normalizedAddress !== existingAddress;

    const explicitLatitude = input.latitude ?? null;
    const explicitLongitude = input.longitude ?? null;
    const existingLatitude =
      !referenceChanged && input.existing?.deliveryLatitude != null
        ? Number(input.existing.deliveryLatitude)
        : null;
    const existingLongitude =
      !referenceChanged && input.existing?.deliveryLongitude != null
        ? Number(input.existing.deliveryLongitude)
        : null;

    const latitude = explicitLatitude ?? existingLatitude;
    const longitude = explicitLongitude ?? existingLongitude;
    const pricing = await this.deliveryPricingService.estimate({
      addressText: rawReference,
      reference: rawReference,
      latitude,
      longitude,
      location:
        latitude != null && longitude != null
          ? {
              provider: input.locationProvider ?? input.locationSource ?? null,
              placeId: input.locationPlaceId ?? null,
              formattedAddress: input.locationFormattedAddress ?? rawReference,
              latitude,
              longitude,
              confidence: input.locationConfidence ?? 'HIGH',
            }
          : null,
    });
    const deliveryFee = new Prisma.Decimal(pricing.finalFee ?? 0);
    const deliveryZoneLabel = pricing.zoneLabel;
    const deliveryFeeSuggested = pricing.suggestedFee != null ? new Prisma.Decimal(pricing.suggestedFee) : null;
    const deliveryEstimatedMinutes = pricing.estimatedMinutes != null ? new Prisma.Decimal(pricing.estimatedMinutes) : null;
    const deliveryDistanceKm =
      pricing.distanceKm != null
        ? new Prisma.Decimal(pricing.distanceKm)
        : !referenceChanged && input.existing?.deliveryDistanceKm != null
          ? new Prisma.Decimal(input.existing.deliveryDistanceKm)
          : null;

    const deliveryCustomer = await tx.deliveryCustomer.upsert({
      where: { phone: normalizedPhone },
      update: {
        fullName: input.customerName?.trim() || undefined,
        defaultAddress: rawReference ?? undefined,
        defaultReference: rawReference ?? undefined,
        lastLatitude: latitude != null ? new Prisma.Decimal(latitude) : undefined,
        lastLongitude: longitude != null ? new Prisma.Decimal(longitude) : undefined,
        lastZoneLabel: deliveryZoneLabel ?? undefined,
        lastDistanceKm: deliveryDistanceKm ?? undefined,
        lastLocationAt: latitude != null && longitude != null ? new Date() : undefined,
      },
      create: {
        phone: normalizedPhone,
        fullName: input.customerName?.trim() || null,
        defaultAddress: rawReference,
        defaultReference: rawReference,
        lastLatitude: latitude != null ? new Prisma.Decimal(latitude) : null,
        lastLongitude: longitude != null ? new Prisma.Decimal(longitude) : null,
        lastZoneLabel: deliveryZoneLabel,
        lastDistanceKm: deliveryDistanceKm,
        lastLocationAt: latitude != null && longitude != null ? new Date() : null,
      },
    });

    return {
      deliveryCustomerId: deliveryCustomer.id,
      deliveryAddressNormalized: normalizedAddress ?? rawReference,
      deliveryLatitude: latitude != null ? new Prisma.Decimal(latitude) : null,
      deliveryLongitude: longitude != null ? new Prisma.Decimal(longitude) : null,
      deliveryDistanceKm,
      deliveryZoneLabel,
      deliveryFee,
      deliveryFeeSuggested,
      deliveryFeeEdited: pricing.manualEdited,
      deliveryFeeEditReason: pricing.manualEditReason,
      deliveryPricingStatus: pricing.pricingStatus,
      deliveryPricingConfidence: pricing.confidence,
      deliveryPricingBreakdown: pricing.breakdown as Prisma.InputJsonValue,
      deliveryCalculationVersion: pricing.calculationVersion,
      deliveryRequiresManualQuote: pricing.requiresManualQuote,
      deliveryRouteProvider: pricing.providerUsage.routingProvider ?? input.existing?.deliveryRouteProvider ?? null,
      deliveryWeatherProvider: pricing.providerUsage.weatherProvider ?? input.existing?.deliveryWeatherProvider ?? null,
      deliveryGeocodingProvider: pricing.providerUsage.geocodingProvider ?? input.existing?.deliveryGeocodingProvider ?? null,
      deliveryEstimatedMinutes,
      deliveryPricingAuditId: pricing.auditId ?? null,
      deliveryLocationSource:
        latitude != null && longitude != null
          ? input.locationSource ?? input.locationProvider ?? input.existing?.deliveryLocationSource ?? 'whatsapp_live_location'
          : 'address_zone_estimate',
      deliveryLocationReceivedAt:
        latitude != null && longitude != null
          ? new Date()
          : input.existing?.deliveryLocationReceivedAt
            ? new Date(input.existing.deliveryLocationReceivedAt)
            : null,
    };
  }

  private async restoreSaleStockForReopen(
    tx: Prisma.TransactionClient,
    items: Array<{
      quantity: Prisma.Decimal;
      product: Prisma.ProductGetPayload<{
        include: {
          recipes: {
            include: {
              items: {
                include: {
                  ingredient: true;
                };
              };
            };
          };
        };
      }>;
    }>,
    actorId: string,
    saleId: string,
  ) {
    for (const item of items) {
      const product = item.product;

      if (product.kind === ProductKind.DIRECT_STOCK) {
        // BLOQUEO CONCURRENCIA: Bloquear producto antes de restaurar stock
        await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, product.id);
        const refreshedProduct = await tx.product.findUnique({ where: { id: product.id } });
        if (!refreshedProduct) {
          throw new BadRequestException(`El producto ${product.name} ya no está disponible.`);
        }

        const nextStock = refreshedProduct.currentStock.add(item.quantity);
        await tx.product.update({
          where: { id: product.id },
          data: { currentStock: nextStock },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            type: InventoryMovementType.RETURN,
            quantity: item.quantity,
            unitCost: refreshedProduct.costPrice ?? undefined,
            balanceAfter: nextStock,
            performedById: actorId,
            referenceType: 'order_reopen',
            referenceId: saleId,
            notes: 'Reversa de stock por reapertura de comanda cobrada.',
          },
        });
        continue;
      }

      const recipe = product.recipes[0];
      if (!recipe || !recipe.items.length) {
        throw new BadRequestException(`El producto preparado ${product.name} no tiene receta activa para revertir stock.`);
      }

      for (const recipeItem of recipe.items) {
        // BLOQUEO CONCURRENCIA: Bloquear insumo antes de restaurar stock
        await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, recipeItem.ingredientId);
        const refreshedIngredient = await tx.ingredient.findUnique({ where: { id: recipeItem.ingredientId } });
        if (!refreshedIngredient) {
          throw new BadRequestException(`El insumo ${recipeItem.ingredient.name} ya no está disponible.`);
        }

        const restoredQuantity = item.quantity
          .mul(recipeItem.quantity)
          .div(recipe.yieldQuantity)
          .mul(new Prisma.Decimal(1).add(recipeItem.wastePercent.div(100)));
        const nextStock = refreshedIngredient.currentStock.add(restoredQuantity);

        await tx.ingredient.update({
          where: { id: recipeItem.ingredientId },
          data: { currentStock: nextStock },
        });
        await tx.inventoryMovement.create({
          data: {
            ingredientId: recipeItem.ingredientId,
            type: InventoryMovementType.RETURN,
            quantity: restoredQuantity,
            unitCost: refreshedIngredient.costPrice ?? undefined,
            balanceAfter: nextStock,
            performedById: actorId,
            referenceType: 'order_reopen',
            referenceId: saleId,
            notes: `Reversa de receta por reapertura de ${product.name}.`,
          },
        });
      }
    }
  }

  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
    type: OrderTicketType,
  ): Promise<string> {
    const prefix = this.getOrderPrefix(type);
    const knownPrefixes = ['MOSTRADOR-', 'MESA-', 'DOMICILIO-', 'LLEVAR-'];

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260331)`;

    const existingNumbers = await tx.orderTicket.findMany({
      where: {
        OR: knownPrefixes.map((knownPrefix) => ({
          number: {
            startsWith: knownPrefix,
          },
        })),
      },
      select: {
        number: true,
      },
    });

    const lastSequence = existingNumbers.reduce((highest, order) => {
      const currentSequence = Number.parseInt(order.number.split('-').pop() ?? '0', 10) || 0;
      return Math.max(highest, currentSequence);
    }, 0);

    return `${prefix}-${String(lastSequence + 1).padStart(3, '0')}`;
  }

  private getOrderPrefix(type: OrderTicketType): string {
    switch (type) {
      case OrderTicketType.DINE_IN:
        return 'MESA';
      case OrderTicketType.TAKEAWAY:
        return 'MOSTRADOR';
      case OrderTicketType.DELIVERY:
        return 'DOMICILIO';
      case OrderTicketType.COUNTER:
      default:
        return 'MOSTRADOR';
    }
  }

  private isOrderNumberConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes('number')
    );
  }


  private formatCurrency(value: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private buildWhatsAppUrl(phone: string | null) {
    if (!phone) {
      return null;
    }

    const digits = phone.replace(/\D/g, '');
    if (!digits) {
      return null;
    }

    if (digits.length === 10) {
      return `https://wa.me/57${digits}`;
    }

    return `https://wa.me/${digits}`;
  }

  async estimateDeliveryFee(params: { lat?: string; lng?: string; address?: string }) {
    return this.deliveryPricingService.estimate({
      addressText: params.address,
      latitude: params.lat ? Number(params.lat) : null,
      longitude: params.lng ? Number(params.lng) : null,
    });
  }

  async findDeliveryCustomer(phone?: string, name?: string) {
    // 1. Buscar por teléfono normalizado (prioridad máxima)
    if (phone) {
      const normalized = normalizePhone(phone);
      if (normalized) {
        const byPhoneNorm = await this.prisma.deliveryCustomer.findFirst({
          where: { phoneNormalized: normalized },
        });
        if (byPhoneNorm) return byPhoneNorm;
      }
      // Fallback: búsqueda parcial por phone original
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 7) {
        const byPhonePartial = await this.prisma.deliveryCustomer.findFirst({
          where: { phone: { contains: digits.slice(-10) } },
        });
        if (byPhonePartial) return byPhonePartial;
      }
    }

    // 2. Buscar por nombre normalizado
    if (name && name.length >= 3) {
      const normalizedName = normalizeSearchText(name);
      if (normalizedName) {
        const byName = await this.prisma.deliveryCustomer.findFirst({
          where: { fullNameNormalized: { contains: normalizedName } },
          orderBy: { updatedAt: 'desc' },
        });
        if (byName) return byName;
      }
    }

    return null;
  }

  async searchCustomers(q: string) {
    if (!q || q.length < 2) return [];

    const normalized = normalizeSearchText(q);
    const digits = q.replace(/\D/g, '');

    const results = await this.prisma.deliveryCustomer.findMany({
      where: {
        OR: [
          // Teléfono exacto normalizado
          ...(digits.length >= 7 ? [{ phoneNormalized: { contains: digits.slice(-10) } }] : []),
          // Teléfono original contiene
          ...(digits.length >= 7 ? [{ phone: { contains: digits.slice(-10) } }] : []),
          // Nombre normalizado contiene
          ...(normalized.length >= 3 ? [{ fullNameNormalized: { contains: normalized } }] : []),
          // Dirección normalizada contiene
          ...(normalized.length >= 3 ? [{ defaultAddressNormalized: { contains: normalized } }] : []),
        ].filter(Boolean),
      },
      take: 10,
      orderBy: { updatedAt: 'desc' },
    });

    return results;
  }

  async findOrCreateCustomer(dto: { fullName?: string; phone?: string; defaultAddress?: string }) {
    let customer = null;

    // 1. Buscar por teléfono normalizado
    if (dto.phone) {
      customer = await this.findDeliveryCustomer(dto.phone);
    }

    // 2. Si no hay teléfono o no se encontró, buscar por nombre + dirección
    if (!customer && dto.fullName && dto.fullName.length >= 3) {
      const normalizedName = normalizeSearchText(dto.fullName);
      const where: any = { fullNameNormalized: { contains: normalizedName } };
      if (dto.defaultAddress) {
        const normalizedAddr = normalizeAddrForCustomer(dto.defaultAddress);
        if (normalizedAddr) {
          where.defaultAddressNormalized = { contains: normalizedAddr };
        }
      }
      customer = await this.prisma.deliveryCustomer.findFirst({ where, orderBy: { updatedAt: 'desc' } });
    }

    // 3. Crear o actualizar
    if (customer) {
      // Actualizar campos vacíos con datos nuevos (sin sobrescribir datos buenos)
      const updates: any = {};
      if (dto.fullName && (!customer.fullName || customer.fullName.length < 2)) {
        updates.fullName = dto.fullName;
        updates.fullNameNormalized = normalizeSearchText(dto.fullName);
      }
      if (dto.defaultAddress && (!customer.defaultAddress || customer.defaultAddress.length < 5)) {
        updates.defaultAddress = dto.defaultAddress;
        updates.defaultAddressNormalized = normalizeAddrForCustomer(dto.defaultAddress);
      }
      if (dto.phone && !customer.phone) {
        updates.phone = dto.phone;
        updates.phoneNormalized = normalizePhone(dto.phone);
      }
      if (Object.keys(updates).length > 0) {
        customer = await this.prisma.deliveryCustomer.update({
          where: { id: customer.id },
          data: updates,
        });
      }
      return { customer, created: false };
    }

    // 4. Crear nuevo cliente - validar mínimo de datos
    const phoneNormalized = dto.phone ? normalizePhone(dto.phone) : null;
    if (!phoneNormalized && (!dto.fullName || dto.fullName.length < 2)) {
      return null; // insuficientes datos
    }

    // Verificar anti-duplicado por phoneNormalized antes de crear
    if (phoneNormalized) {
      const existing = await this.prisma.deliveryCustomer.findFirst({
        where: { phoneNormalized },
      });
      if (existing) {
        return { customer: existing, created: false };
      }
    }

    const newCustomer = await this.prisma.deliveryCustomer.create({
      data: {
        fullName: dto.fullName || null,
        fullNameNormalized: dto.fullName ? normalizeSearchText(dto.fullName) : null,
        phone: dto.phone || `pending-${Date.now()}`,
        phoneNormalized,
        defaultAddress: dto.defaultAddress || null,
        defaultAddressNormalized: dto.defaultAddress ? normalizeAddrForCustomer(dto.defaultAddress) : null,
      },
    });

    return { customer: newCustomer, created: true };
  }

  async upsertDeliveryCustomer(dto: { phone: string; fullName?: string; address?: string }) {
    if (!dto.phone) return null;
    return this.prisma.deliveryCustomer.upsert({
      where: { phone: dto.phone },
      update: {
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
        ...(dto.address ? { defaultAddress: dto.address } : {}),
      },
      create: {
        phone: dto.phone,
        fullName: dto.fullName ?? null,
        defaultAddress: dto.address ?? null,
      },
    });
  }
}
