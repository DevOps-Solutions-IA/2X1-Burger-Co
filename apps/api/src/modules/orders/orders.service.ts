import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  CustomerConsentChannel,
  CustomerConsentPurpose,
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
  PaymentIntentStatus,
  Prisma,
  ProductKind,
  SaleChannel,
  SaleStatus,
} from '@prisma/client';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import {
  normalizeReceiptBusinessAddress,
  normalizeReceiptBusinessPhone,
  renderDeliveryReceiptPdf,
} from './delivery-receipt.renderer';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal, toNumber } from '../../common/utils/decimal.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateSaleDto } from '../sales/dto/create-sale.dto';
import { SalesService } from '../sales/sales.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TablesService } from '../tables/tables.service';
import { DeliveryPricingService } from '../../delivery/delivery-pricing/delivery-pricing.service';
import { deriveCheckoutAuthorizationFromOrderSnapshot } from '../../delivery/delivery-pricing/delivery-checkout-authorization';
import { CheckoutOrderTicketDto } from './dto/checkout-order-ticket.dto';
import { AssignDeliveryRiderDto } from './dto/assign-delivery-rider.dto';
import { ClaimOrderTicketDto } from './dto/claim-order-ticket.dto';
import { CreateOrderTicketDto } from './dto/create-order-ticket.dto';
import { ReplaceOrderTicketItemsDto } from './dto/replace-order-ticket-items.dto';
import { ReopenOrderTicketDto } from './dto/reopen-order-ticket.dto';
import { SyncWaiterOrderDto } from './dto/sync-waiter-order.dto';
import { UpdateDeliveryWorkflowDto } from './dto/update-delivery-workflow.dto';
import { UpdateOrderTicketDto } from './dto/update-order-ticket.dto';
import type { KitchenTransitionDto } from './dto/kitchen-transition.dto';
import type { ListOperationalOrdersDto } from './dto/list-operational-orders.dto';
import { normalizeSearchText, normalizePhone, normalizeAddressText as normalizeAddrForCustomer } from '../../common/normalization/customer-normalization';
import { DeliveryWorkflowService } from '../delivery-operations/delivery-workflow.service';
import { DeliveryLocationPolicy } from '../delivery-operations/delivery-location.policy';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import {
  applyDestinationEdit,
  isCoordinateEvidenceMateriallyDifferent,
  isCoordinateProvisionallyUsable,
} from '../../delivery/destination-state/destination-revision';
import {
  fromDeliveryPricingAudit,
  fromOrderTicketDeliveryColumns,
  toOrderTicketDeliveryColumns,
  type DeliveryPricingAuditEvidenceRow,
  type OrderTicketDeliveryColumns,
} from '../../delivery/destination-state/destination-state.persistence';
import {
  DestinationStateError,
  type CoordinateSource,
  type DestinationEdit,
  type DestinationSnapshot,
} from '../../delivery/destination-state/destination-snapshot.types';

const ACTIVE_ORDER_STATUSES: OrderTicketStatus[] = [
  OrderTicketStatus.OPEN,
  OrderTicketStatus.IN_PREPARATION,
  OrderTicketStatus.SERVED,
  OrderTicketStatus.PAYMENT_PENDING,
];

const KITCHEN_MANAGED_STATUSES = new Set<OrderTicketStatus>([
  OrderTicketStatus.OPEN,
  OrderTicketStatus.IN_PREPARATION,
  OrderTicketStatus.SERVED,
]);

/** SOFIA Round 5 / A20 CLOSURE — the destination/pricing-authority evidence
 * `createFromCanonicalCheckout()` writes onto a new `OrderTicket`, reconstructed from the
 * checkout's linked `DeliveryPricingAudit` row. See `materializeDeliveryEvidenceFromPricingAudit`. */
type DeliveryMaterializationEvidence = {
  deliveryLatitude: Prisma.Decimal | null;
  deliveryLongitude: Prisma.Decimal | null;
  deliveryLocationSource: string | null;
  deliveryLocationReceivedAt: Date | null;
  deliveryGeocodingProvider: string | null;
  deliveryPricingStatus: string | null;
  deliveryPricingConfidence: string | null;
  deliveryPricingBreakdown: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  deliveryCalculationVersion: string | null;
  deliveryRequiresManualQuote: boolean;
  deliveryFeeSuggested: Prisma.Decimal | null;
  deliveryFeeEdited: boolean;
  deliveryFeeEditReason: string | null;
  deliveryZoneLabel: string | null;
  deliveryDistanceKm: Prisma.Decimal | null;
  deliveryEstimatedMinutes: Prisma.Decimal | null;
  deliveryRouteProvider: string | null;
  deliveryWeatherProvider: string | null;
};

/** Fail-closed default: no audit evidence found/linked (TAKEAWAY fulfillment, or a DELIVERY
 * checkout whose audit pointer is missing/dangling) — every column stays exactly as unset/NULL as
 * before this fix, never fabricated. */
const EMPTY_DELIVERY_MATERIALIZATION_EVIDENCE: DeliveryMaterializationEvidence = {
  deliveryLatitude: null,
  deliveryLongitude: null,
  deliveryLocationSource: null,
  deliveryLocationReceivedAt: null,
  deliveryGeocodingProvider: null,
  deliveryPricingStatus: null,
  deliveryPricingConfidence: null,
  deliveryPricingBreakdown: Prisma.JsonNull,
  deliveryCalculationVersion: null,
  deliveryRequiresManualQuote: false,
  deliveryFeeSuggested: null,
  deliveryFeeEdited: false,
  deliveryFeeEditReason: null,
  deliveryZoneLabel: null,
  deliveryDistanceKm: null,
  deliveryEstimatedMinutes: null,
  deliveryRouteProvider: null,
  deliveryWeatherProvider: null,
};

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
  // A69/A70 (CRITICAL, blind red-team finding): `createdBy: true` used to fetch and serialize the
  // FULL `User` row — including `passwordHash`/`accessCodeHash`/`sessionVersion` — into the JSON
  // response of every route sharing this single `orderInclude` object (~30 call sites across this
  // file: findAll()/findOne()/create()/checkout()/kitchen transitions/delivery assignment/etc),
  // reachable by any `cashier`. Shaped to the SAME `{ id, fullName, accessName }` tier already
  // used two lines below for `assignedWaiter` — an order's creator can be a waiter (PIN/accessName
  // login) just as easily as a cashier/admin (email/password login), so `accessName` stays
  // relevant here unlike the email/password-only modules (sales/purchases/cash-register/expenses).
  createdBy: {
    select: {
      id: true,
      fullName: true,
      accessName: true,
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
  orderCheckout: {
    select: {
      id: true,
      status: true,
      paymentPreference: true,
      total: true,
      currency: true,
      paymentIntents: {
        select: {
          id: true,
          attemptNumber: true,
          provider: true,
          amount: true,
          currency: true,
          status: true,
          failureCode: true,
          completedAt: true,
          updatedAt: true,
        },
        orderBy: { attemptNumber: 'desc' },
        take: 10,
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

const DELIVERY_PAYMENT_TARGET = '3160527403';

// A69/A70/A73/A74: same COST_VISIBILITY_PERMISSION gate as products.service.ts (A65)/
// reports.service.ts (A67)/sales.service.ts (A69) — `orders.read`/`orders.create`/`orders.update`/
// `orders.checkout`/`delivery.*` (held by cashier/supervisor/waiter/delivery) stay reachable, but
// `items[].product.costPrice` is stripped from every HTTP response unless the caller also holds
// `products.update` (admin/inventory).
//
// A73 (CRITICAL, blind red-team finding, live PoC-confirmed): A69/A70 only applied this gate to
// findAll()/findOne(). Every OTHER call site below that reads `orderInclude`/`orderInclude`-shaped
// data and returns it straight to an HTTP response reachable by a non-cost-visible role
// (waiter/cashier/supervisor/delivery — only admin/inventory hold `products.update` per
// prisma/seed.ts) leaked the exact same `costPrice` scalar right back out through create()/
// update()/replaceItems()/syncWaiterOrder()/claim()/claimDelivery()/assignDeliveryRider()/
// updateDeliveryWorkflow()/checkout()/reopen()/transitionKitchen()/resolveDeliveryLocationInbox().
// All of those now strip via canViewOrderCost()/stripOrderItemsCost() too, exactly like
// findAll()/findOne() already did.
//
// Left UNCHANGED (verified not reachable with raw cost by any HTTP caller, see A73/A74 fix
// commit message for the full sweep table): createFromCanonicalCheckout() (only consumer is
// SofiaCreateOrderCommandHandler, which discards the result down to {id, number, replayed}
// scalars before it ever reaches a SecureCommand HTTP response — never serializes the order
// itself); generateCurrentDeliveryReceiptPdf()/generateDeliveryReceiptPdf() (renders a PDF from an
// explicit field allowlist — name/quantity/unitPrice/totalPrice — costPrice is never read into the
// render payload); captureDeliveryLocationFromWhatsapp()/applyDeliveryLocationFromWhatsapp() (no
// production caller anywhere in the codebase — only exercised by tests, not wired to any
// controller/webhook today); reconcileDeliveryWorkflowConsequences()/
// reconcilePendingDeliveryWorkflowConsequences() (private/worker-only — the HTTP-facing callers
// that consume their result — assignDeliveryRider()/claimDelivery()/updateDeliveryWorkflow() — are
// where the strip is applied instead); findWaiterActive()/findDeliveryActive()/listOperational()/
// listKitchenQueue()/findDeliveryLocationInbox() (all `select`-shaped with an explicit field
// allowlist that never includes `costPrice`).
const ORDER_COST_VISIBILITY_PERMISSION = 'products.update';

function canViewOrderCost(viewerPermissions: string[] | undefined) {
  return (viewerPermissions ?? []).includes(ORDER_COST_VISIBILITY_PERMISSION);
}

export function resolveDeliveryReceiptPayment(paymentMethod?: string | null) {
  if (paymentMethod === 'NEQUI_MANUAL') {
    return { label: 'Nequi', target: DELIVERY_PAYMENT_TARGET };
  }
  if (paymentMethod === 'CASH') {
    return { label: 'Efectivo contra entrega', target: null };
  }
  if (paymentMethod === 'ONLINE') {
    return { label: 'Pago en línea', target: null };
  }
  return { label: null, target: null };
}

@Injectable()
export class OrdersService {
  /**
   * A56/A57 (round 5) — module-scope allowlist for the `OrdersController`-exposed
   * `/orders/operational-alerts*` routes.
   *
   * `OperationalAlert` is a SHARED table: this service only ever creates rows with
   * `module: 'orders'` / `'deliveries'` / `'waiters'` (POS/kitchen/delivery/waiter-operational
   * signals meant for cashier/supervisor/waiter/delivery staff — e.g. "comanda lista para
   * cobro"), while SOFIA governance/production-safety alerts (`module: 'sofia'`, e.g.
   * `SOFIA_REAL_SEND_ATTEMPT_BLOCKED`, `SOFIA_NO_ACTIVE_PROMPT`) are created and owned by
   * `SofiaAlertsService` and are intentionally restricted to `@Roles('admin','supervisor')` +
   * `settings.read`/`settings.update` on their own dedicated route (`GET/POST
   * /admin/sofia/alerts*`, see `sofia.controller.ts`).
   *
   * Because both routes read/write the same table, this allowlist is the single source of
   * truth that keeps the two authorization surfaces from silently drifting apart again: any
   * module NOT in this list (most importantly `'sofia'`) must never be readable or mutable
   * through this less-privileged, POS-facing route, regardless of role or permission grants
   * on `OrdersController`. If a new operational-alert-producing module is added to this
   * service, add it here explicitly — do not widen this to "everything except sofia".
   */
  private static readonly ORDERS_OPERATIONAL_ALERT_MODULES: readonly string[] = [
    'orders',
    'deliveries',
    'waiters',
  ];

  private readonly deliveryLocationPolicy = new DeliveryLocationPolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly salesService: SalesService,
    private readonly realtimeService: RealtimeService,
    private readonly deliveryPricingService: DeliveryPricingService,
    private readonly tablesService: TablesService,
    private readonly deliveryWorkflow: DeliveryWorkflowService,
    private readonly notificationOutbox: NotificationOutboxService,
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

  private readAuditJsonObject(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
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

    await this.notificationOutbox.enqueue({
      eventType: 'DELIVERY_RECEIPT_UPDATED',
      sourceEventId: idempotencyKey,
      aggregateType: 'ORDER_TICKET',
      aggregateId: input.order.id,
      aggregateVersion: input.order.revision,
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
      factEnvelope: {
        orderNumber: input.order.number,
        receiptUpdated: true,
        previousTotal: Number(input.previousTotal),
        total: Number(input.order.subtotal),
      },
      policyOutcome: 'SUPPRESSED',
      policyReason: 'AUTO_WHATSAPP_DISABLED',
    });
    await this.auditService.log({
      userId: input.actorId,
      action: 'DELIVERY_UPDATED_RECEIPT_SEND_SUPPRESSED',
      module: 'orders',
      entity: 'order_ticket',
      entityId: input.order.id,
      newValues: {
        revision: input.order.revision,
        receiptUpdated: true,
        sendAttempted: false,
        sendSucceeded: false,
        failureReason: 'AUTO_WHATSAPP_DISABLED',
        phoneMasked,
        idempotencyKey,
      },
    });
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

  async findAll(status?: string, activeOnly = false, viewerPermissions?: string[]) {
    const filterStatuses = activeOnly
      ? ACTIVE_ORDER_STATUSES
      : status
        ? [status as OrderTicketStatus]
        : undefined;

    const orders = await this.prisma.orderTicket.findMany({
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

    if (canViewOrderCost(viewerPermissions)) {
      return orders;
    }

    return orders.map((order) => this.stripOrderItemsCost(order));
  }

  // A69: mirror products.service.ts's stripProductCost() / sales.service.ts's stripSaleCost() —
  // strip the raw `costPrice` scalar from every nested `items[].product` so a cashier viewing the
  // order list/detail cannot read supplier cost. Every real Prisma read through `orderInclude`
  // always includes `items`, but some pre-existing unit tests construct narrower mock payloads
  // (e.g. orders.phase8-operations.spec.ts's canonical-checkout-only fixture) that omit `items`
  // entirely — tolerate that shape rather than throwing, since there is nothing to strip.
  private stripOrderItemsCost<T extends { items?: Array<{ product: { costPrice: unknown } }> }>(order: T) {
    if (!order.items) {
      return order;
    }

    return {
      ...order,
      items: order.items.map((item) => {
        const { costPrice: _costPrice, ...productRest } = item.product;
        return { ...item, product: productRest };
      }),
    };
  }

  async listOperational(query: ListOperationalOrdersDto) {
    const where = this.operationalOrderWhere(query);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.orderTicket.count({ where }),
      this.prisma.orderTicket.findMany({
        where,
        select: {
          id: true,
          number: true,
          revision: true,
          status: true,
          type: true,
          customerName: true,
          customerPhone: true,
          subtotal: true,
          deliveryFee: true,
          deliveryWorkflowStatus: true,
          deliveryStatusUpdatedAt: true,
          openedAt: true,
          updatedAt: true,
          assignedWaiter: { select: { id: true, fullName: true, accessName: true } },
          assignedRider: { select: { id: true, fullName: true } },
          orderCheckout: {
            select: {
              id: true,
              status: true,
              paymentPreference: true,
              paymentIntents: {
                select: { id: true, status: true, provider: true },
                orderBy: { attemptNumber: 'desc' },
                take: 1,
              },
            },
          },
          _count: { select: { items: true, customerServiceCases: true } },
        },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async listKitchenQueue(query: ListOperationalOrdersDto) {
    const where: Prisma.OrderTicketWhereInput = {
      ...this.operationalOrderWhere(query),
      status: query.status ?? { in: [OrderTicketStatus.OPEN, OrderTicketStatus.IN_PREPARATION] },
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.orderTicket.count({ where }),
      this.prisma.orderTicket.findMany({
        where,
        select: {
          id: true,
          number: true,
          revision: true,
          status: true,
          type: true,
          customerName: true,
          notes: true,
          openedAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              notes: true,
              modifiersSnapshot: true,
              product: { select: { name: true, code: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
          orderCheckout: {
            select: {
              id: true,
              status: true,
              paymentPreference: true,
              paymentIntents: {
                select: { id: true, status: true, provider: true },
                orderBy: { attemptNumber: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async transitionKitchen(id: string, dto: KitchenTransitionDto, actor: AuthUser) {
    if (!this.isPrivilegedOrderOperator(actor) || !actor.permissions.includes('orders.update')) {
      throw new ForbiddenException({ code: 'KITCHEN_TRANSITION_FORBIDDEN' });
    }

    const order = await this.prisma.orderTicket.findUnique({
      where: { id },
      select: { id: true, status: true, revision: true },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_TICKET_NOT_FOUND' });
    if (order.revision !== dto.expectedRevision) {
      throw new ConflictException({ code: 'STALE_ORDER_REVISION' });
    }
    const expectedStatus = dto.action === 'START_PREPARATION'
      ? OrderTicketStatus.OPEN
      : OrderTicketStatus.IN_PREPARATION;
    const nextStatus = dto.action === 'START_PREPARATION'
      ? OrderTicketStatus.IN_PREPARATION
      : OrderTicketStatus.SERVED;
    if (order.status !== expectedStatus) {
      throw new ConflictException({ code: 'KITCHEN_TRANSITION_BLOCKED' });
    }
    this.assertKitchenTransitionPolicy(order.status, nextStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.orderTicket.updateMany({
        where: {
          id,
          revision: dto.expectedRevision,
          status: expectedStatus,
        },
        data: {
          status: nextStatus,
          servedAt: nextStatus === OrderTicketStatus.SERVED ? new Date() : undefined,
          revision: { increment: 1 },
        },
      });

      if (!result.count) {
        throw new ConflictException({ code: 'STALE_ORDER_REVISION' });
      }

      const transitioned = await tx.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });

      await this.auditService.log({
        userId: actor.sub,
        action: 'KITCHEN_TRANSITION',
        module: 'orders',
        entity: 'order_ticket',
        entityId: id,
        oldValues: { status: order.status, revision: order.revision },
        newValues: {
          status: transitioned.status,
          revision: transitioned.revision,
          action: dto.action,
        },
      }, tx);

      return transitioned;
    });

    this.realtimeService.publishOrderUpdated({
      entityId: updated.id,
      orderType: updated.type,
      status: updated.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('orders');
    return canViewOrderCost(actor.permissions) ? updated : this.stripOrderItemsCost(updated);
  }

  private assertKitchenStatusIsNotChangedOutsideKitchenAuthority(
    currentStatus: OrderTicketStatus,
    requestedStatus: OrderTicketStatus | undefined,
  ) {
    if (
      requestedStatus === undefined ||
      requestedStatus === currentStatus ||
      !KITCHEN_MANAGED_STATUSES.has(requestedStatus)
    ) {
      return;
    }

    throw new ConflictException({
      code: 'KITCHEN_TRANSITION_REQUIRES_GOVERNED_ENDPOINT',
    });
  }

  private assertKitchenTransitionPolicy(
    currentStatus: OrderTicketStatus,
    requestedStatus: OrderTicketStatus,
  ) {
    if (currentStatus === requestedStatus) {
      return;
    }

    const allowed =
      (currentStatus === OrderTicketStatus.OPEN &&
        requestedStatus === OrderTicketStatus.IN_PREPARATION) ||
      (currentStatus === OrderTicketStatus.IN_PREPARATION &&
        requestedStatus === OrderTicketStatus.SERVED);
    if (!allowed) {
      throw new ConflictException({ code: 'KITCHEN_TRANSITION_BLOCKED' });
    }
  }

  private operationalOrderWhere(query: ListOperationalOrdersDto): Prisma.OrderTicketWhereInput {
    const activeStatuses = { in: ACTIVE_ORDER_STATUSES };
    const search = query.q?.trim();
    return {
      ...(query.status
        ? { status: query.status }
        : query.activeOnly === 'true'
          ? { status: activeStatuses }
          : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.deliveryWorkflowStatus ? { deliveryWorkflowStatus: query.deliveryWorkflowStatus } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { customerPhone: { contains: search } },
            ],
          }
        : {}),
    };
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

  private async resolveOperationalAlertsInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      module?: string;
      entityType?: string;
      entityId?: string;
      types?: string[];
      resolvedById?: string | null;
    },
  ) {
    const alerts = await tx.operationalAlert.findMany({
      where: {
        ...(input.module ? { module: input.module } : {}),
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.types?.length ? { type: { in: input.types } } : {}),
        status: { in: [OperationalAlertStatus.OPEN, OperationalAlertStatus.ACKNOWLEDGED] },
      },
    });
    if (!alerts.length) return [];

    await tx.operationalAlert.updateMany({
      where: { id: { in: alerts.map((alert) => alert.id) } },
      data: {
        status: OperationalAlertStatus.RESOLVED,
        resolvedById: input.resolvedById ?? null,
        resolvedAt: new Date(),
      },
    });
    return alerts;
  }

  private publishOperationalAlert(alert: {
    id: string;
    module: string;
    severity: OperationalAlertSeverity;
    status: OperationalAlertStatus;
    entityType: string | null;
    entityId: string | null;
  }) {
    this.realtimeService.publishOperationalAlertUpdated({
      alertId: alert.id,
      module: alert.module,
      severity: alert.severity,
      status: alert.status,
      entityType: alert.entityType,
      entityId: alert.entityId,
    });
  }

  /**
   * SOFIA Round 5 / A16 CLOSURE (CRITICAL, A15 blind red team finding): resolves the coordinate pair
   * this order's CURRENTLY PERSISTED delivery price (`deliveryFee`/`deliveryPricingBreakdown`/
   * `deliveryPricingStatus`) was actually computed against — a FIXED "priced anchor" — as opposed to
   * `order.deliveryLatitude`/`deliveryLongitude`, which the logistics-only live-location path
   * (`applyDeliveryLocationForLogisticsOnlyInTransaction`) overwrites on EVERY tracking ping
   * regardless of whether a real repricing occurred. Comparing new evidence against that WALKING
   * "last ping" reference instead of a FIXED anchor is exactly what let A15 walk a destination
   * arbitrarily far away via many individually-sub-threshold hops (each hop under the 150m
   * `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` relative to the PREVIOUS ping, but cumulatively
   * >9.7km from the point the price was computed for).
   *
   * NO NEW COLUMN: reuses the existing `DeliveryPricingAudit` table every REAL repricing pass
   * (`resolveDeliverySnapshot` -> `DeliveryPricingService.estimate()`) already writes and links to
   * this order via `orderTicketId` (see `create()`/`update()`'s `deliveryPricingAudit.updateMany`
   * linking, run atomically in the SAME transaction as the repricing write). The logistics-only path
   * NEVER creates or links an audit row, so "the most recent audit row for this `orderTicketId`" is,
   * by construction, always exactly the one that produced the CURRENTLY persisted price — never a
   * value a tracking ping could have moved.
   *
   * FAILS CLOSED: if the order has a real pricing snapshot (caller-determined) but no anchor can be
   * recovered here (audit row missing/unlinked), returns `anchorFound: false` so the caller treats
   * ANY new coordinate evidence as materially different rather than silently trusting a walking
   * reference again — never assume "no evidence of drift" means "no drift" (CLAUDE.md fail-closed).
   */
  private async resolvePricedAnchorCoordinates(
    db: Prisma.TransactionClient | PrismaService,
    order: { id: string },
  ): Promise<{ latitude: number | null; longitude: number | null; anchorFound: boolean }> {
    const audit = await db.deliveryPricingAudit.findFirst({
      where: { orderTicketId: order.id },
      orderBy: { createdAt: 'desc' },
      select: { requestJson: true },
    });

    if (!audit) {
      return { latitude: null, longitude: null, anchorFound: false };
    }

    const requestJson = audit.requestJson as { latitude?: unknown; longitude?: unknown } | null;
    const anchorLatitude = typeof requestJson?.latitude === 'number' ? requestJson.latitude : null;
    const anchorLongitude = typeof requestJson?.longitude === 'number' ? requestJson.longitude : null;

    // A real repricing pass that was itself computed WITHOUT coordinates (e.g. a LOCAL_FREE
    // zone-alias match) is a legitimate, discoverable anchor state ("priced with no evidence"), not
    // a lookup failure — `isCoordinateEvidenceMateriallyDifferent` already treats evidence appearing
    // from that state as material (RULE: fail closed on appearance, see destination-revision.ts).
    return { latitude: anchorLatitude, longitude: anchorLongitude, anchorFound: true };
  }

  /**
   * Detects an operational/data-quality anomaly: does this incoming ping look like a sudden,
   * implausible jump relative to whatever coordinate is MOST RECENTLY on file for this order (e.g. a
   * GPS glitch, or a sign the ping actually belongs to a different customer/order than it matched)?
   * This is DELIBERATELY a walking-reference ("most recently observed") comparison — a genuinely
   * different concept from the pricing-safety gate below (`deliveryRequiresManualQuote`, fed by
   * `resolvePricedAnchorCoordinates`'s FIXED priced anchor). SOFIA Round 5 / A16 CLOSURE
   * (investigated as part of the A15 finding): anchoring THIS check to the fixed priced point too
   * was considered and rejected — it would fire partway through any ordinary gradual live-location
   * walk (as soon as cumulative drift from the anchor first exceeds the threshold, long before any
   * genuinely large single jump occurred), diverting the ping to REQUIRES_REVIEW and preventing it
   * from ever reaching `applyDeliveryLocationForLogisticsOnlyInTransaction` — which would starve the
   * canonical, dedicated pricing-safety mechanism (`deliveryRequiresManualQuote`, reused per A14/A16,
   * "do not build a second gate") of the chance to ever run for that order. Only reuses the SAME
   * `isCoordinateEvidenceMateriallyDifferent` predicate (no duplicated threshold math) — the
   * distance formula changed from a flat-earth approximation to the canonical haversine helper;
   * numerically equivalent at this threshold's scale (~150m).
   */
  private deliveryLocationConflicts(
    currentLatitude: Prisma.Decimal | null | undefined,
    currentLongitude: Prisma.Decimal | null | undefined,
    incomingLatitude: number,
    incomingLongitude: number,
  ): boolean {
    if (currentLatitude == null || currentLongitude == null) return false;
    return isCoordinateEvidenceMateriallyDifferent(
      Number(currentLatitude),
      Number(currentLongitude),
      incomingLatitude,
      incomingLongitude,
    );
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
      deliveryFee?: Prisma.Decimal | null;
      items: Array<{ totalPrice: Prisma.Decimal }>;
      updatedAt: Date;
      openedAt: Date;
    }>,
    senderPhoneCandidates: string[],
  ) {
    const decision = this.deliveryLocationPolicy.resolveMatch(
      senderPhoneCandidates,
      activeDeliveryOrders.map((order) => ({
        orderId: order.id,
        fulfillment: order.type,
        active: ACTIVE_ORDER_STATUSES.includes(order.status),
        customerPhone: order.customerPhone,
      })),
    );
    if (decision.status !== 'MATCHED') return null;
    const order = activeDeliveryOrders.find((candidate) => candidate.id === decision.orderId);
    return order ? { order, rule: decision.rule } : null;
  }

  async findOne(id: string, viewerPermissions?: string[]) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    return canViewOrderCost(viewerPermissions) ? order : this.stripOrderItemsCost(order);
  }

  /* Cuenta vigente para visualización: renderiza el estado actual de la orden
     con el tipo correcto (inicial o actualizada) sin generar auditoría nueva.
     `actor` se exige para reutilizar la misma verificación de propiedad que ya
     protege claimDelivery()/updateDeliveryWorkflow() sobre este mismo recurso:
     un domiciliario solo puede ver la cuenta de sus propios domicilios (o de
     domicilios aún sin asignar), nunca de un domicilio ajeno. */
  async generateCurrentDeliveryReceiptPdf(id: string, actor: AuthUser) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        assignedRider: {
          select: {
            fullName: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('No se encontró la comanda.');
    }

    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio pueden generar una cuenta pendiente.');
    }

    this.assertDeliveryWorkflowAccess(order, actor, { allowClaim: true });

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
    const address = normalizeReceiptBusinessAddress(
      typeof businessProfile.address === 'string' ? businessProfile.address : '',
    );
    const phone = normalizeReceiptBusinessPhone(
      typeof businessProfile.phone === 'string' ? businessProfile.phone : '',
    );
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
    const payment = resolveDeliveryReceiptPayment(order.whatsappDeliveryOrder?.paymentMethod);

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
      paymentMethodLabel: payment.label,
      paymentTarget: payment.target,
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

  async getDeliveryReceiptStatus(orderId: string, actor: AuthUser) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        type: true,
        number: true,
        subtotal: true,
        deliveryFee: true,
        openedAt: true,
        assignedRiderId: true,
        assignedRider: { select: { fullName: true } },
      },
    });
    if (!order) throw new NotFoundException('No se encontró la comanda.');
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio tienen cuenta de domicilio.');
    }

    this.assertDeliveryWorkflowAccess(order, actor, { allowClaim: true });

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

  async getDeliveryReceiptHistory(orderId: string, actor: AuthUser) {
    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        type: true,
        number: true,
        subtotal: true,
        openedAt: true,
        assignedRiderId: true,
        assignedRider: { select: { fullName: true } },
      },
    });
    if (!order) throw new NotFoundException('No se encontró la comanda.');
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new BadRequestException('Solo las comandas de domicilio tienen historial de cuenta.');
    }

    this.assertDeliveryWorkflowAccess(order, actor, { allowClaim: true });

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

    // A73: typed against the actual `orderInclude` shape (not the untyped generic default of
    // `ReturnType<typeof this.prisma.orderTicket.create>`, which has no `items` relation at all)
    // so `stripOrderItemsCost()` below can see `items[].product.costPrice` and type-check.
    let order: Prisma.OrderTicketGetPayload<{ include: typeof orderInclude }> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        order = await this.prisma.$transaction(async (tx) => {
          const table = await this.resolveTableForOrder(tx, dto.tableId, type);
          if (actor.roles.includes('waiter') && !this.isPrivilegedOrderOperator(actor)) {
            await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
          }
          const { items, priceOverrides } = await this.buildOrderItems(tx, dto.items, {
            trustProvidedUnitPrice: this.isPrivilegedOrderOperator(actor),
          });
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

          await this.auditService.log(
            {
              userId: actor.sub,
              action: 'CREATE',
              module: 'orders',
              entity: 'order_ticket',
              entityId: created.id,
              newValues: dto,
            },
            tx,
          );

          await this.auditItemPriceOverrides(tx, actor, created.id, priceOverrides);

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

    // A73 (CRITICAL, blind red-team finding, live PoC-confirmed): POST /orders returned the raw
    // `orderInclude`-shaped order — including `items[].product.costPrice` — to any caller holding
    // `orders.create` (admin/cashier/supervisor/waiter), none of whom besides admin hold
    // `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? order : this.stripOrderItemsCost(order);
  }

  async createFromCanonicalCheckout(checkoutId: string, actor: AuthUser) {
    const session = await this.getCurrentCashSession();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({
        where: { id: checkoutId },
        include: { orderTicket: { include: orderInclude }, sofiaDraft: true },
      });
      if (!checkout) throw new NotFoundException('No se encontró el checkout canónico.');
      if (checkout.orderTicket) return { order: checkout.orderTicket, replayed: true };
      if (checkout.status !== 'KITCHEN_ELIGIBLE') {
        throw new ConflictException({ code: 'KITCHEN_NOT_ELIGIBLE' });
      }
      if (checkout.fulfillment !== OrderTicketType.DELIVERY && checkout.fulfillment !== OrderTicketType.TAKEAWAY) {
        throw new BadRequestException('Fulfillment no soportado para checkout canónico.');
      }
      if (checkout.source === 'SOFIA') {
        const draft = checkout.sofiaDraft;
        const validBinding =
          draft?.status === 'CONFIRMED' &&
          draft.version === checkout.sofiaDraftVersion &&
          draft.draftHash === checkout.sofiaDraftHash &&
          draft.confirmationHash === checkout.confirmationHash &&
          Boolean(draft.expiresAt && draft.expiresAt.getTime() > Date.now());
        if (!validBinding) throw new ConflictException({ code: 'SOFIA_DRAFT_BINDING_INVALID' });
      }

      const itemSnapshots = this.parseCanonicalCheckoutItems(checkout.itemsSnapshot);
      // `itemSnapshots` are already server-derived from `product.persistedPrice` at draft time
      // by SOFIA's commercial authority (`SofiaService.buildItemsSnapshot`) — never raw client
      // input reachable by `waiter` — and are independently cross-checked below against
      // `checkout.total` (`CHECKOUT_PRICE_CHANGED`), so it is safe and correct to keep trusting
      // them here.
      const { items } = await this.buildOrderItems(tx, itemSnapshots, {
        trustProvidedUnitPrice: true,
      });
      const itemsSubtotal = items.reduce((sum, item) => sum.add(item.totalPrice), new Prisma.Decimal(0));
      const expectedItemsSubtotal = checkout.total.sub(checkout.deliveryFee);
      if (!itemsSubtotal.equals(expectedItemsSubtotal)) {
        throw new ConflictException({ code: 'CHECKOUT_PRICE_CHANGED' });
      }
      const customer = this.readAuditJsonObject(checkout.customerSnapshot);
      const customerName = typeof customer.name === 'string' ? customer.name : null;
      const deliveryAddress = typeof customer.deliveryAddress === 'string' ? customer.deliveryAddress : null;
      if (checkout.fulfillment === OrderTicketType.DELIVERY && !deliveryAddress) {
        throw new ConflictException({ code: 'CHECKOUT_DELIVERY_ADDRESS_REQUIRED' });
      }

      // SOFIA Round 5 / A20 CLOSURE (HIGH, A19 blind finding): this call site used to copy ONLY
      // `deliveryFee` (money) and `deliveryAddress` (text) from the checkout's `customerSnapshot`
      // onto the new `OrderTicket`, and NEVER followed `customer.deliveryQuoteAuditId` back to the
      // `DeliveryPricingAudit` row that actually priced the destination — so the trusted GPS pair
      // SOFIA's canonical destination-state authority (A9-A14) resolved during the conversation, and
      // the pricing-authority evidence (`deliveryPricingStatus`/`deliveryCalculationVersion`/
      // `deliveryPricingBreakdown`) proving HOW the fee was resolved, were both silently dropped —
      // permanently blocking `OrdersService.checkout()` (`deriveCheckoutAuthorizationFromOrderSnapshot`
      // requires that evidence) and leaving `assertDeliveryOrder`'s dispatch gate with zero coordinate
      // evidence to reason about. Fixed by reusing the SAME canonical machinery legacy POS's
      // `resolveDeliverySnapshot` already uses: `fromDeliveryPricingAudit` (destination-state
      // persistence Tier 2/2b) reconstructs the `DestinationSnapshot` the audit row represents, and
      // `toOrderTicketDeliveryColumns` maps it onto the exact same OrderTicket columns. The audit row
      // is then linked back via `orderTicketId` exactly like legacy `create()`/`update()` do, so
      // future drift-anchor resolution (A16) and audit-trail reconciliation work for SOFIA-originated
      // orders too. Never re-invokes the pricing engine here — the checkout's `deliveryFee` is
      // already locked/confirmed with the customer; re-quoting at materialization time could silently
      // diverge from the price actually confirmed.
      let deliveryEvidence: DeliveryMaterializationEvidence = EMPTY_DELIVERY_MATERIALIZATION_EVIDENCE;
      let deliveryPricingAuditIdToLink: string | null = null;
      if (checkout.fulfillment === OrderTicketType.DELIVERY) {
        const auditId = typeof customer.deliveryQuoteAuditId === 'string' ? customer.deliveryQuoteAuditId : null;
        const audit = auditId
          ? await tx.deliveryPricingAudit.findUnique({
              where: { id: auditId },
              select: {
                id: true,
                requestJson: true,
                resultJson: true,
                providerSummaryJson: true,
                suggestedFee: true,
                finalFee: true,
                manualEdited: true,
                manualEditReason: true,
                calculationVersion: true,
              },
            })
          : null;
        // Fail closed (CLAUDE.md section 5): if the checkout carries no audit pointer, or the
        // pointer is dangling (row deleted/never existed), leave every destination/pricing column
        // NULL — exactly the pre-fix behavior — rather than fabricate evidence that was never proven.
        // A genuinely coordinate-less LOCAL_FREE audit (zone-alias match, no GPS ever submitted) is
        // NOT this case: it still resolves a real audit row, just with null coordinates, and
        // `materializeDeliveryEvidenceFromPricingAudit` below still correctly authorizes it for
        // checkout via `deliveryPricingStatus`/`deliveryCalculationVersion`/`deliveryPricingBreakdown`.
        if (audit) {
          deliveryEvidence = this.materializeDeliveryEvidenceFromPricingAudit(audit, new Date());
          deliveryPricingAuditIdToLink = audit.id;
        }
      }

      const order = await tx.orderTicket.create({
        data: {
          number: await this.generateOrderNumber(tx, checkout.fulfillment),
          type: checkout.fulfillment,
          customerName,
          customerPhone: null,
          deliveryReference: deliveryAddress,
          deliveryAddressNormalized: deliveryAddress,
          deliveryFee: checkout.deliveryFee,
          deliveryLatitude: deliveryEvidence.deliveryLatitude,
          deliveryLongitude: deliveryEvidence.deliveryLongitude,
          deliveryLocationSource: deliveryEvidence.deliveryLocationSource,
          deliveryLocationReceivedAt: deliveryEvidence.deliveryLocationReceivedAt,
          deliveryGeocodingProvider: deliveryEvidence.deliveryGeocodingProvider,
          deliveryPricingStatus: deliveryEvidence.deliveryPricingStatus,
          deliveryPricingConfidence: deliveryEvidence.deliveryPricingConfidence,
          deliveryPricingBreakdown: deliveryEvidence.deliveryPricingBreakdown,
          deliveryCalculationVersion: deliveryEvidence.deliveryCalculationVersion,
          deliveryRequiresManualQuote: deliveryEvidence.deliveryRequiresManualQuote,
          deliveryFeeSuggested: deliveryEvidence.deliveryFeeSuggested,
          deliveryFeeEdited: deliveryEvidence.deliveryFeeEdited,
          deliveryFeeEditReason: deliveryEvidence.deliveryFeeEditReason,
          deliveryZoneLabel: deliveryEvidence.deliveryZoneLabel,
          deliveryDistanceKm: deliveryEvidence.deliveryDistanceKm,
          deliveryEstimatedMinutes: deliveryEvidence.deliveryEstimatedMinutes,
          deliveryRouteProvider: deliveryEvidence.deliveryRouteProvider,
          deliveryWeatherProvider: deliveryEvidence.deliveryWeatherProvider,
          deliveryWorkflowStatus:
            checkout.fulfillment === OrderTicketType.DELIVERY
              ? DeliveryWorkflowStatus.PENDING_ASSIGNMENT
              : null,
          deliveryStatusUpdatedAt:
            checkout.fulfillment === OrderTicketType.DELIVERY ? new Date() : null,
          subtotal: checkout.total,
          cashSessionId: session.id,
          createdById: actor.sub,
          notes: `Checkout ${checkout.source}:${checkout.sourceReference}`,
          items: { create: items },
        },
        include: orderInclude,
      });
      const attached = await tx.orderCheckout.updateMany({
        where: { id: checkout.id, version: checkout.version, orderTicketId: null, status: 'KITCHEN_ELIGIBLE' },
        data: { orderTicketId: order.id, status: 'ORDER_CREATED', version: { increment: 1 } },
      });
      if (attached.count !== 1) throw new ConflictException({ code: 'CHECKOUT_ORDER_CONFLICT' });
      // Link the audit row back to the order — matching legacy POS `create()`/`update()`'s
      // `deliveryPricingAudit.updateMany({ where: { id, orderTicketId: null }, data: { orderTicketId } })`
      // — so an auditor/reconciliation process can walk from this OrderTicket to the exact
      // `DeliveryPricingAudit` row that priced it, and A16's drift-anchor resolution works for
      // SOFIA-originated orders too.
      if (deliveryPricingAuditIdToLink) {
        await tx.deliveryPricingAudit.updateMany({
          where: { id: deliveryPricingAuditIdToLink, orderTicketId: null },
          data: { orderTicketId: order.id },
        });
      }
      await this.auditService.log(
        {
          userId: actor.sub,
          action: 'CREATE_FROM_CANONICAL_CHECKOUT',
          module: 'orders',
          entity: 'order_ticket',
          entityId: order.id,
          result: 'SUCCESS',
          reasonCode: checkout.paymentPreference,
          idempotencyKey: checkout.idempotencyKey,
          newValues: {
            checkoutId: checkout.id,
            source: checkout.source,
            fulfillment: checkout.fulfillment,
            paymentPreference: checkout.paymentPreference,
            itemCount: items.length,
            total: checkout.total.toString(),
            deliveryPricingAuditId: deliveryPricingAuditIdToLink,
          },
        },
        tx,
      );
      return { order, replayed: false };
    });

    this.realtimeService.publishOrderUpdated({
      entityId: result.order.id,
      orderType: result.order.type,
      status: result.order.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('orders');
    return result;
  }

  /**
   * SOFIA Round 5 / A20 CLOSURE — companion to `createFromCanonicalCheckout()`'s call site above.
   * Reconstructs the FULL destination/pricing-authority evidence a `DeliveryPricingAudit` row
   * already carries into the SAME `OrderTicket` delivery* column shape legacy POS's
   * `resolveDeliverySnapshot` writes (see that private method's own `persistedColumns`/return value)
   * — destination columns (coordinates/location source/geocoding provider) via
   * `fromDeliveryPricingAudit` + `toOrderTicketDeliveryColumns` (the canonical destination-state Tier
   * 1/2 machinery A9 built), pricing-authority columns straight from the audit row's own typed
   * columns (`calculationVersion`/`suggestedFee`/`manualEdited`/`manualEditReason`) and `resultJson`
   * (`pricingStatus`/`requiresManualQuote`/`zoneLabel`/`distanceKm`/`estimatedMinutes`/`confidence`).
   * Never re-invokes the pricing engine — see the call site's comment for why.
   */
  private materializeDeliveryEvidenceFromPricingAudit(
    audit: DeliveryPricingAuditEvidenceRow & {
      providerSummaryJson: Prisma.JsonValue | null;
      suggestedFee: Prisma.Decimal | null;
      finalFee: Prisma.Decimal | null;
      manualEdited: boolean;
      manualEditReason: string | null;
      calculationVersion: string;
    },
    now: Date,
  ): DeliveryMaterializationEvidence {
    const snapshot = fromDeliveryPricingAudit(audit);
    const destinationColumns: OrderTicketDeliveryColumns | null = snapshot
      ? toOrderTicketDeliveryColumns(snapshot, now)
      : null;

    const result = this.readAuditJsonObject(audit.resultJson);
    const providerUsage = this.readAuditJsonObject(audit.providerSummaryJson);
    const pricingStatus =
      typeof result.pricingStatus === 'string'
        ? result.pricingStatus
        : typeof result.status === 'string'
          ? result.status
          : null;
    // Fail closed: an unresolved/unknown status (or a status not in the two automated
    // "resolved" statuses) is treated as still requiring manual attention, exactly like the live
    // pricing engine does for every non-happy-path branch (`delivery-pricing.engine.ts`).
    const requiresManualQuote =
      typeof result.requiresManualQuote === 'boolean'
        ? result.requiresManualQuote
        : pricingStatus !== 'LOCAL_FREE' && pricingStatus !== 'AUTO_PRICED';
    const zoneLabel = typeof result.zoneLabel === 'string' ? result.zoneLabel : null;
    const distanceKm = typeof result.distanceKm === 'number' ? new Prisma.Decimal(result.distanceKm) : null;
    const estimatedMinutes =
      typeof result.estimatedMinutes === 'number' ? new Prisma.Decimal(result.estimatedMinutes) : null;
    const confidence = typeof result.confidence === 'string' ? result.confidence : null;

    return {
      deliveryLatitude:
        destinationColumns?.deliveryLatitude != null ? new Prisma.Decimal(destinationColumns.deliveryLatitude as number) : null,
      deliveryLongitude:
        destinationColumns?.deliveryLongitude != null ? new Prisma.Decimal(destinationColumns.deliveryLongitude as number) : null,
      deliveryLocationSource: destinationColumns?.deliveryLocationSource ?? null,
      deliveryLocationReceivedAt: destinationColumns?.deliveryLocationReceivedAt ?? null,
      deliveryGeocodingProvider: destinationColumns?.deliveryGeocodingProvider ?? null,
      deliveryPricingStatus: pricingStatus,
      deliveryPricingConfidence: confidence,
      deliveryPricingBreakdown: (audit.resultJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      deliveryCalculationVersion: audit.calculationVersion ?? null,
      deliveryRequiresManualQuote: requiresManualQuote,
      deliveryFeeSuggested: audit.suggestedFee ?? null,
      deliveryFeeEdited: audit.manualEdited ?? false,
      deliveryFeeEditReason: audit.manualEditReason ?? null,
      deliveryZoneLabel: zoneLabel,
      deliveryDistanceKm: distanceKm,
      deliveryEstimatedMinutes: estimatedMinutes,
      deliveryRouteProvider: typeof providerUsage.routingProvider === 'string' ? providerUsage.routingProvider : null,
      deliveryWeatherProvider: typeof providerUsage.weatherProvider === 'string' ? providerUsage.weatherProvider : null,
    };
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

    this.assertKitchenStatusIsNotChangedOutsideKitchenAuthority(
      current.status,
      dto.status as OrderTicketStatus | undefined,
    );

    const access = this.assertWaiterOrderWriteAccess(current, actor);
    const requestedType = dto.type as OrderTicketType | undefined;
    if (
      requestedType !== undefined &&
      requestedType !== current.type &&
      (requestedType === OrderTicketType.DELIVERY || current.type === OrderTicketType.DELIVERY)
    ) {
      throw new ConflictException({
        code: 'DELIVERY_FULFILLMENT_CHANGE_REQUIRES_GOVERNED_TRANSITION',
      });
    }
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
      // SOFIA Round 5 / A18 CLOSURE (HIGH, A17 blind finding): `resolveDeliverySnapshot` used to be
      // invoked UNCONDITIONALLY for every DELIVERY-type `update()` call, regardless of whether the
      // caller's DTO actually carried any address-confirming evidence. When the DTO omitted
      // `deliveryReference`/`deliveryLatitude`/`deliveryLongitude` entirely (e.g. a `notes`-only
      // edit), `resolveDeliverySnapshot` fell back to reconstructing "current truth" from whatever
      // was PERSISTED on `current` — including `deliveryLatitude`/`deliveryLongitude` columns that
      // ordinary courier-tracking pings (`applyDeliveryLocationForLogisticsOnlyInTransaction`) may
      // have overwritten with a marker (`whatsapp_live_location`) INDISTINGUISHABLE, at the
      // persistence layer, from a genuine customer address confirmation. That silently laundered
      // tracking-only drift into a fresh commercial re-price and a new `DeliveryPricingAudit`
      // anchor, clearing `deliveryRequiresManualQuote` (A16's protection) with zero genuine address
      // evidence ever supplied for THIS call. See
      // `round5-a17-blind-redteam-tracking-anchor-laundering.spec.ts` for the full reproduction.
      //
      // Fix: only re-run the destination-edit/re-pricing branch when THIS call's DTO carries
      // genuine, explicit address-confirming input — a new `deliveryReference` text, or coordinates
      // supplied directly on the DTO (even a lone axis counts as an intentional address-editing
      // attempt by the caller, never something an unrelated `notes`/item edit would ever set). Any
      // other edit (notes-only, item-only, status-only, etc.) carries the existing delivery* columns
      // forward VERBATIM — no re-derivation, no re-pricing, no new audit row, no flag reset. This
      // reuses the canonical `resolveDeliverySnapshot`/`applyDestinationEdit` authority exactly as
      // before for genuine address input; it does not introduce a parallel model.
      const hasAddressRelevantInput =
        dto.deliveryReference !== undefined ||
        dto.deliveryLatitude !== undefined ||
        dto.deliveryLongitude !== undefined;
      const deliverySnapshot =
        nextType === OrderTicketType.DELIVERY
          ? hasAddressRelevantInput
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
            : this.carryForwardDeliverySnapshot(current)
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
          // SOFIA Round 5 / A12 CLOSURE: for DELIVERY orders, `deliveryReference` MUST be written
          // from the SAME `deliverySnapshot` that produced every derived delivery* column below —
          // never independently from the raw `dto.deliveryReference` (which Prisma treats as "leave
          // column untouched" when `undefined`, e.g. a coordinates-only PATCH). Writing it
          // independently let two truly concurrent `update()` calls (one coordinates-only, one
          // reference-only) commit a row where the reference text came from ONE transaction but the
          // coordinates/pricing came from the OTHER's now-stale computation — a real reproduced
          // hybrid destination (see `resolveDeliverySnapshot`'s `deliveryReference` field comment
          // and `round5-a12-cross-cutting-verification.spec.ts` case 26b). Non-DELIVERY orders keep
          // the original raw-DTO-driven semantics (no destination-state authority involved there).
          deliveryReference:
            nextType === OrderTicketType.DELIVERY
              ? deliverySnapshot?.deliveryReference ?? null
              : dto.deliveryReference === undefined ? undefined : dto.deliveryReference.trim() || null,
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

    // A73 (CRITICAL, blind red-team finding, live PoC-confirmed): PATCH /orders/:id returned the
    // raw `orderInclude`-shaped order — including `items[].product.costPrice` — to any caller
    // holding `orders.update` (admin/cashier/supervisor/waiter), none of whom besides admin hold
    // `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? updated : this.stripOrderItemsCost(updated);
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
      const { items, priceOverrides } = await this.buildOrderItems(tx, dto.items, {
        trustProvidedUnitPrice: this.isPrivilegedOrderOperator(actor),
      });
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
        await this.auditService.log(
          {
            userId: actor.sub,
            action: 'UPDATE_ITEMS',
            module: 'orders',
            entity: 'order_ticket',
            entityId: id,
            result: 'NO_OP',
            reasonCode: 'ORDER_ITEMS_UNCHANGED',
            newValues: dto,
          },
          tx,
        );
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

      const updatedOrder = await tx.orderTicket.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        });

      await this.auditService.log(
        {
          userId: actor.sub,
          action: 'UPDATE_ITEMS',
          module: 'orders',
          entity: 'order_ticket',
          entityId: id,
          oldValues: {
            subtotal: current.subtotal,
            revision: current.revision,
          },
          newValues: {
            subtotal: updatedOrder.subtotal,
            revision: updatedOrder.revision,
            items: dto.items,
          },
        },
        tx,
      );

      await this.auditItemPriceOverrides(tx, actor, id, priceOverrides);

      let receiptVersion: number | null = null;
      if (updatedOrder.type === OrderTicketType.DELIVERY) {
        const refreshedCount = await tx.auditLog.count({
          where: {
            module: 'orders',
            entity: 'order_ticket',
            entityId: id,
            action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
          },
        });
        const previousVersion = refreshedCount + 1;
        receiptVersion = previousVersion + 1;
        await this.auditService.log(
          {
            userId: actor.sub,
            action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
            module: 'orders',
            entity: 'order_ticket',
            entityId: id,
            oldValues: { previousTotal: current.subtotal },
            newValues: {
              newTotal: updatedOrder.subtotal,
              deliveryFee: updatedOrder.deliveryFee,
              receiptVersion,
              receiptRegenerated: true,
              message: 'Pedido actualizado. Nueva cuenta generada con total vigente.',
            },
          },
          tx,
        );
        await this.auditService.log(
          {
            userId: actor.sub,
            action: 'DELIVERY_RECEIPT_REPLACED',
            module: 'orders',
            entity: 'order_ticket',
            entityId: id,
            oldValues: { receiptVersion: previousVersion, status: 'REPLACED' },
            newValues: {
              receiptVersion,
              status: 'ACTIVE',
              previousTotal: current.subtotal,
              newTotal: updatedOrder.subtotal,
            },
          },
          tx,
        );
      }

      return {
        order: updatedOrder,
        commercialChanged: true,
        receiptVersion,
      };
    });
    const updated = updateResult.order;

    if (updated.type === OrderTicketType.DELIVERY && updateResult.commercialChanged) {
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

    // A73 (CRITICAL, blind red-team finding, live PoC-confirmed): PUT /orders/:id/items returned
    // the raw `orderInclude`-shaped order — including `items[].product.costPrice` — to any caller
    // holding `orders.update` (admin/cashier/supervisor/waiter), none of whom besides admin hold
    // `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? updated : this.stripOrderItemsCost(updated);
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

      // A73 (CRITICAL, blind red-team finding): same gate as the fresh-write paths below — an
      // idempotent replay must not leak `costPrice` any more than the original write did.
      return canViewOrderCost(actor.permissions)
        ? cachedReceipt.orderTicket
        : this.stripOrderItemsCost(cachedReceipt.orderTicket);
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

        const { items, priceOverrides } = await this.buildOrderItems(tx, dto.items, {
          trustProvidedUnitPrice: this.isPrivilegedOrderOperator(actor),
        });
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
          this.assertKitchenStatusIsNotChangedOutsideKitchenAuthority(
            current.status,
            dto.status as OrderTicketStatus | undefined,
          );

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

          await this.auditItemPriceOverrides(tx, actor, order.id, priceOverrides);

          return {
            order,
            action: access.shouldAssign ? ('WAITER_SYNC_CLAIM' as const) : ('WAITER_SYNC_UPDATE' as const),
          };
        }

        const table = await this.resolveTableForOrder(tx, dto.tableId, OrderTicketType.DINE_IN);
        await this.tablesService.assertWaiterCanOperateTable(actor, table?.id, tx);
        if (
          dto.status === OrderTicketStatus.IN_PREPARATION ||
          dto.status === OrderTicketStatus.SERVED
        ) {
          throw new ConflictException({
            code: 'KITCHEN_TRANSITION_REQUIRES_GOVERNED_ENDPOINT',
          });
        }
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

        await this.auditItemPriceOverrides(tx, actor, order.id, priceOverrides);

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
      // A73 (CRITICAL, blind red-team finding, live PoC-confirmed): POST /orders/waiter-sync
      // returned the raw `orderInclude`-shaped order — including `items[].product.costPrice` — to
      // any caller holding `orders.create` (admin/cashier/supervisor/waiter), none of whom besides
      // admin hold `products.update`. Same gate as findAll()/findOne() (A69/A70).
      return canViewOrderCost(actor.permissions) ? result.order : this.stripOrderItemsCost(result.order);
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
        return canViewOrderCost(actor.permissions)
          ? receipt.orderTicket
          : this.stripOrderItemsCost(receipt.orderTicket);
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
      const alreadyOwned = await this.prisma.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
      // A73 (CRITICAL, blind red-team finding): same gate as the fresh-claim path below.
      return canViewOrderCost(actor.permissions) ? alreadyOwned : this.stripOrderItemsCost(alreadyOwned);
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
    // A73 (CRITICAL, blind red-team finding): POST /orders/:id/claim returned the raw
    // `orderInclude`-shaped order — including `items[].product.costPrice` — to any caller holding
    // `orders.update` (admin/cashier/supervisor/waiter), none of whom besides admin hold
    // `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? claimed : this.stripOrderItemsCost(claimed);
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

    const transition = await this.deliveryWorkflow.transition({
      orderTicketId: id,
      expectedVersion: current.deliveryWorkflowVersion,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: rider.id,
      actorId: actor.sub,
      reasonCode: 'DELIVERY_RIDER_ASSIGNED',
      idempotencyKey: `delivery:assign:${id}:${current.deliveryWorkflowVersion}:${rider.id}`,
      sanitizedMetadata: {
        previousAssignedRiderId: current.assignedRiderId,
        assignedRiderId: rider.id,
        notes: this.sanitizeDeliveryWorkflowNote(dto.notes),
      },
    });
    const reconciled = await this.reconcileDeliveryWorkflowConsequences({
      orderTicketId: id,
      workflowVersion: transition.version,
    });
    const assigned =
      reconciled?.order ??
      (await this.prisma.orderTicket.findUniqueOrThrow({ where: { id }, include: orderInclude }));
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
    // A73 (CRITICAL, blind red-team finding): POST /orders/:id/assign-rider (and its /assign-
    // delivery alias) returned the raw `orderInclude`-shaped order — including
    // `items[].product.costPrice` — to any caller holding `delivery.assign`
    // (admin/cashier/supervisor), none of whom besides admin hold `products.update`. Same gate as
    // findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? assigned : this.stripOrderItemsCost(assigned);
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
      const alreadyOwned = await this.prisma.orderTicket.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      });
      // A73 (CRITICAL, blind red-team finding): same gate as assignDeliveryRider() below (which
      // this method delegates to for the fresh-claim path) — an already-owned-delivery replay must
      // not leak `costPrice` any more than a fresh assignment would.
      return canViewOrderCost(actor.permissions) ? alreadyOwned : this.stripOrderItemsCost(alreadyOwned);
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

  private async reconcileDeliveryWorkflowConsequences(input: {
    orderTicketId: string;
    workflowVersion: number;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const event = await tx.deliveryWorkflowEvent.findUnique({
        where: {
          orderTicketId_version: {
            orderTicketId: input.orderTicketId,
            version: input.workflowVersion,
          },
        },
      });
      if (!event) return null;

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-workflow-consequences:${event.id}`}, 0))
      `;

      const order = await tx.orderTicket.findUniqueOrThrow({
        where: { id: input.orderTicketId },
        include: orderInclude,
      });
      const metadata = this.readDeliveryWorkflowMetadata(event.sanitizedMetadata);
      const notes = metadata.notes;
      let effectiveOrder = order;
      if (notes && !String(order.notes ?? '').split('\n').includes(notes)) {
        effectiveOrder = await tx.orderTicket.update({
          where: { id: order.id },
          data: { notes: [order.notes, notes].filter(Boolean).join('\n') },
          include: orderInclude,
        });
      }

      let deliveryIssueId: string | null = null;
      if (event.toStatus === DeliveryWorkflowStatus.ISSUE) {
        const issueType = metadata.issueType;
        const issue = await tx.deliveryIssue.upsert({
          where: {
            orderTicketId_idempotencyKey: {
              orderTicketId: order.id,
              idempotencyKey: `delivery-issue:${order.id}:${event.version}`,
            },
          },
          update: {},
          create: {
            orderTicketId: order.id,
            idempotencyKey: `delivery-issue:${order.id}:${event.version}`,
            issueType,
            summary: this.buildDeliveryIssueSummary(issueType, notes),
            details: notes,
            reportedById: event.actorId ?? effectiveOrder.createdById,
          },
        });
        deliveryIssueId = issue.id;
      }

      if (event.toStatus === DeliveryWorkflowStatus.DELIVERED) {
        await tx.deliveryIssue.updateMany({
          where: { orderTicketId: order.id, status: DeliveryIssueStatus.OPEN },
          data: {
            status: DeliveryIssueStatus.RESOLVED,
            resolvedById: event.actorId,
            resolvedAt: event.createdAt,
            version: { increment: 1 },
          },
        });
      }

      const consequenceKey = `delivery:workflow:event:${event.id}`;
      const isRiderAssignment = event.toStatus === DeliveryWorkflowStatus.ASSIGNED;
      const auditAction = isRiderAssignment
        ? 'ASSIGN_DELIVERY_RIDER'
        : 'UPDATE_DELIVERY_WORKFLOW';
      const existingAudit = await tx.auditLog.findFirst({
        where: { idempotencyKey: consequenceKey, action: auditAction },
      });
      if (!existingAudit) {
        await this.auditService.log(
          {
            userId: event.actorId ?? undefined,
            action: auditAction,
            module: 'orders',
            entity: 'order_ticket',
            entityId: order.id,
            idempotencyKey: consequenceKey,
            oldValues: {
              deliveryWorkflowStatus: event.fromStatus,
              ...(isRiderAssignment
                ? {
                    assignedRiderId:
                      event.sanitizedMetadata &&
                      typeof event.sanitizedMetadata === 'object' &&
                      !Array.isArray(event.sanitizedMetadata) &&
                      'previousAssignedRiderId' in event.sanitizedMetadata
                        ? event.sanitizedMetadata.previousAssignedRiderId
                        : null,
                  }
                : {}),
            },
            newValues: {
              status: effectiveOrder.status,
              deliveryWorkflowStatus: event.toStatus,
              assignedRiderId: effectiveOrder.assignedRiderId,
              ...(isRiderAssignment
                ? { assignedRiderName: effectiveOrder.assignedRider?.fullName ?? null }
                : {}),
              notes,
              workflowVersion: event.version,
            },
          },
          tx,
        );
      }

      const alertType =
        event.toStatus === DeliveryWorkflowStatus.ASSIGNED
          ? 'DELIVERY_ASSIGNED'
          : event.toStatus === DeliveryWorkflowStatus.IN_TRANSIT
          ? 'DELIVERY_IN_TRANSIT'
          : event.toStatus === DeliveryWorkflowStatus.DELIVERED
            ? 'DELIVERY_DELIVERED'
            : event.toStatus === DeliveryWorkflowStatus.ISSUE
              ? 'DELIVERY_ISSUE'
              : 'DELIVERY_WORKFLOW_UPDATED';
      let alert = await tx.operationalAlert.findFirst({
        where: {
          type: alertType,
          module: 'deliveries',
          entityType: 'order_ticket',
          entityId: order.id,
          metadata: { path: ['deliveryWorkflowEventId'], equals: event.id },
        },
      });
      if (!alert) {
        alert = await tx.operationalAlert.create({
          data: {
            type: alertType,
            module: 'deliveries',
            severity:
              event.toStatus === DeliveryWorkflowStatus.ISSUE
                ? OperationalAlertSeverity.CRITICAL
                : OperationalAlertSeverity.INFO,
            title:
              event.toStatus === DeliveryWorkflowStatus.ASSIGNED
                ? 'Domicilio asignado'
                : event.toStatus === DeliveryWorkflowStatus.IN_TRANSIT
                ? 'Domicilio en camino'
                : event.toStatus === DeliveryWorkflowStatus.DELIVERED
                  ? 'Domicilio entregado'
                  : event.toStatus === DeliveryWorkflowStatus.ISSUE
                    ? 'Domicilio con novedad'
                    : 'Flujo de delivery actualizado',
            message:
              event.toStatus === DeliveryWorkflowStatus.ASSIGNED
                ? `${effectiveOrder.number} fue asignado a ${effectiveOrder.assignedRider?.fullName ?? 'un domiciliario'}.`
                : event.toStatus === DeliveryWorkflowStatus.IN_TRANSIT
                ? `${effectiveOrder.number} salió a entrega.`
                : event.toStatus === DeliveryWorkflowStatus.DELIVERED
                  ? `${effectiveOrder.number} fue marcado como entregado.`
                  : event.toStatus === DeliveryWorkflowStatus.ISSUE
                    ? `${effectiveOrder.number} quedó con una novedad operativa.`
                    : `${effectiveOrder.number} actualizó su estado de reparto.`,
            entityType: 'order_ticket',
            entityId: order.id,
            actorId: event.actorId,
            deliveryIssueId,
            metadata: {
              deliveryWorkflowEventId: event.id,
              workflowVersion: event.version,
              workflowStatus: event.toStatus,
              ...(isRiderAssignment
                ? {
                    riderId: effectiveOrder.assignedRiderId,
                    riderName: effectiveOrder.assignedRider?.fullName ?? null,
                  }
                : {}),
              notesPresent: Boolean(notes),
              issueType: metadata.issueType,
            },
          },
        });
      }

      const resolvedAlerts =
        event.toStatus === DeliveryWorkflowStatus.DELIVERED
          ? await this.resolveOperationalAlertsInTransaction(tx, {
              module: 'deliveries',
              entityType: 'order_ticket',
              entityId: order.id,
              types: ['DELIVERY_ISSUE', 'DELIVERY_LOCATION_RECEIVED', 'DELIVERY_ASSIGNED', 'DELIVERY_IN_TRANSIT'],
              resolvedById: event.actorId,
            })
          : [];

      return { order: effectiveOrder, event, alert, resolvedAlerts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!result) return null;
    await this.enqueueDeliveryWorkflowNotification(result);
    this.publishOperationalAlert(result.alert);
    for (const alert of result.resolvedAlerts) {
      this.publishOperationalAlert({ ...alert, status: OperationalAlertStatus.RESOLVED });
    }
    return result;
  }

  async reconcilePendingDeliveryWorkflowConsequences(limit = 25): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const candidates = await this.prisma.$queryRaw<Array<{
      orderTicketId: string;
      version: number;
    }>>`
      SELECT
        event.order_ticket_id AS "orderTicketId",
        event.version
      FROM delivery_workflow_events event
      WHERE NOT EXISTS (
        SELECT 1
        FROM audit_logs audit
        WHERE audit.idempotency_key = CONCAT('delivery:workflow:event:', event.id)
      ) OR (
        event.to_status::text IN ('ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'ISSUE')
        AND NOT EXISTS (
          SELECT 1
          FROM notification_intents notification
          WHERE notification.aggregate_type = 'DELIVERY_WORKFLOW_EVENT'
            AND notification.source_event_id = event.id
            AND notification.channel = 'WHATSAPP'
            AND notification.purpose = 'SERVICE'
        )
      )
      ORDER BY event.created_at ASC
      LIMIT ${boundedLimit}
    `;

    let completed = 0;
    for (const candidate of candidates) {
      const reconciled = await this.reconcileDeliveryWorkflowConsequences({
        orderTicketId: candidate.orderTicketId,
        workflowVersion: candidate.version,
      });
      if (reconciled) completed += 1;
    }
    return completed;
  }

  private async enqueueDeliveryWorkflowNotification(result: {
    event: {
      id: string;
      toStatus: DeliveryWorkflowStatus;
      version: number;
      createdAt: Date;
    };
    order: {
      id: string;
      number: string;
    };
  }): Promise<void> {
    const message = this.deliveryWorkflowCustomerMessage(result.event.toStatus, result.order.number);
    if (!message) return;
    const binding = await this.prisma.orderTicket.findUnique({
      where: { id: result.order.id },
      select: {
        whatsappDeliveryOrder: { select: { conversationId: true } },
        orderCheckout: {
          select: {
            customerId: true,
            sofiaDraft: { select: { conversationId: true } },
          },
        },
      },
    });
    const conversationId = binding?.whatsappDeliveryOrder?.conversationId
      ?? binding?.orderCheckout?.sofiaDraft?.conversationId
      ?? null;
    const conversation = conversationId
      ? await this.prisma.whatsappConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, customerId: true, phone: true, provider: true, handoffVersion: true },
        })
      : null;
    const account = conversation
      ? await this.prisma.whatsappProviderAccount.findFirst({
          where: { provider: conversation.provider, status: 'VERIFIED_RECEIVE_ONLY' },
          orderBy: [{ lastVerifiedAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        })
      : null;
    const canMaterialize = Boolean(conversation && account);
    const bodyHash = createHash('sha256').update(message.body).digest('hex');
    await this.notificationOutbox.enqueue({
      eventType: message.eventType,
      sourceEventId: result.event.id,
      aggregateType: 'DELIVERY_WORKFLOW_EVENT',
      aggregateId: result.order.id,
      aggregateVersion: result.event.version,
      customerId: conversation?.customerId ?? binding?.orderCheckout?.customerId ?? null,
      conversationId: conversation?.id ?? null,
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
      factEnvelope: canMaterialize
        ? {
            orderNumber: result.order.number,
            workflowStatus: result.event.toStatus,
            conversationId: conversation!.id,
            accountId: account!.id,
            recipientIdentityHash: createHash('sha256').update(conversation!.phone).digest('hex'),
            expectedConversationVersion: conversation!.handoffVersion,
            body: message.body,
            bodyHash,
          }
        : {
            orderNumber: result.order.number,
            workflowStatus: result.event.toStatus,
            notificationBindingAvailable: false,
          },
      policyOutcome: canMaterialize ? 'ALLOWED' : 'SUPPRESSED',
      policyReason: canMaterialize ? null : 'WHATSAPP_NOTIFICATION_BINDING_UNAVAILABLE',
      expiresAt: new Date(result.event.createdAt.getTime() + 24 * 60 * 60 * 1_000),
    });
  }

  private deliveryWorkflowCustomerMessage(
    status: DeliveryWorkflowStatus,
    orderNumber: string,
  ): { eventType: string; body: string } | null {
    if (status === DeliveryWorkflowStatus.ASSIGNED) {
      return { eventType: 'DELIVERY_ASSIGNED', body: `Tu pedido ${orderNumber} fue asignado para entrega.` };
    }
    if (status === DeliveryWorkflowStatus.IN_TRANSIT) {
      return { eventType: 'IN_TRANSIT', body: `Tu pedido ${orderNumber} va en camino.` };
    }
    if (status === DeliveryWorkflowStatus.DELIVERED) {
      return { eventType: 'DELIVERED', body: `Tu pedido ${orderNumber} fue marcado como entregado.` };
    }
    if (status === DeliveryWorkflowStatus.ISSUE) {
      return {
        eventType: 'DELIVERY_PROBLEM',
        body: `Tu pedido ${orderNumber} requiere revisión del equipo de entrega.`,
      };
    }
    return null;
  }

  private sanitizeDeliveryWorkflowNote(value: string | undefined): string | null {
    if (value === undefined) return null;
    const note = value.trim();
    if (!note) return null;
    const hasControlCharacters = Array.from(note).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') || code === 127;
    });
    if (note.length > 1_000 || hasControlCharacters) {
      throw new BadRequestException({ code: 'INVALID_DELIVERY_WORKFLOW_NOTE' });
    }
    return note;
  }

  private readDeliveryWorkflowMetadata(value: Prisma.JsonValue | null): {
    notes: string | null;
    issueType: DeliveryIssueType;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { notes: null, issueType: DeliveryIssueType.OTHER };
    }
    const noteValue = 'notes' in value ? value.notes : null;
    const issueValue = 'issueType' in value ? value.issueType : null;
    const notes = typeof noteValue === 'string'
      ? this.sanitizeDeliveryWorkflowNote(noteValue)
      : null;
    const issueType = typeof issueValue === 'string'
      && Object.values(DeliveryIssueType).includes(issueValue as DeliveryIssueType)
      ? issueValue as DeliveryIssueType
      : DeliveryIssueType.OTHER;
    return { notes, issueType };
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

    const transition = await this.deliveryWorkflow.transition({
      orderTicketId: id,
      expectedVersion: current.deliveryWorkflowVersion,
      toStatus: nextStatus,
      assignedRiderId: access.shouldAssignToActor ? actor.sub : undefined,
      actorId: actor.sub,
      reasonCode: `DELIVERY_WORKFLOW_${nextStatus}`,
      idempotencyKey: `delivery:status:${id}:${current.deliveryWorkflowVersion}:${nextStatus}`,
      sanitizedMetadata: {
        notes: this.sanitizeDeliveryWorkflowNote(dto.notes),
        issueType: dto.issueType ?? null,
      },
    });
    const reconciled = await this.reconcileDeliveryWorkflowConsequences({
      orderTicketId: id,
      workflowVersion: transition.version,
    });
    const updated =
      reconciled?.order ??
      (await this.prisma.orderTicket.findUniqueOrThrow({ where: { id }, include: orderInclude }));

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
    // A73 (CRITICAL, blind red-team finding): POST /orders/:id/delivery-workflow (and its PATCH
    // /orders/:id/delivery-status alias) returned the raw `orderInclude`-shaped order — including
    // `items[].product.costPrice` — to any caller holding `delivery.update`
    // (admin/cashier/supervisor/delivery), none of whom besides admin hold `products.update`. Same
    // gate as findAll()/findOne() (A69/A70).
    return canViewOrderCost(actor.permissions) ? updated : this.stripOrderItemsCost(updated);
  }

  async checkout(id: string, dto: CheckoutOrderTicketDto, actorId: string, viewerPermissions?: string[]) {
    const current = await this.prisma.orderTicket.findUnique({
      where: { id },
      include: {
        table: true,
        items: true,
        orderCheckout: {
          include: {
            paymentIntents: {
              where: { status: PaymentIntentStatus.SUCCEEDED },
              orderBy: { completedAt: 'desc' },
            },
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

    const canonicalPaymentIntent = current.orderCheckout?.paymentPreference === 'ONLINE'
      ? current.orderCheckout.paymentIntents[0] ?? null
      : null;
    if (current.orderCheckout?.paymentPreference === 'ONLINE') {
      if (
        current.orderCheckout.paymentIntents.length !== 1 ||
        !canonicalPaymentIntent ||
        !canonicalPaymentIntent.amount.equals(current.subtotal) ||
        canonicalPaymentIntent.currency !== 'COP'
      ) {
        throw new ConflictException({ code: 'CANONICAL_PAYMENT_NOT_VERIFIED' });
      }
    }

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
        paymentIntentId: canonicalPaymentIntent?.id,
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

      await this.auditService.log(
        {
          userId: actorId,
          action: 'CHECKOUT',
          module: 'orders',
          entity: 'order_ticket',
          entityId: id,
          newValues: {
            payments: dto.payments,
            saleId: sale.id,
          },
        },
        tx,
      );

      return {
        order: updatedOrder,
        sale,
      };
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

    // A73 (CRITICAL, blind red-team finding, live PoC-confirmed): POST /orders/:id/checkout
    // returned BOTH the raw `orderInclude`-shaped order (`items[].product.costPrice`) AND the raw
    // `Sale` created via `SalesService.createInTransaction()` (`items[].product.costPrice` again,
    // via that same unshaped `include: { product: true }`) to any caller holding
    // `orders.checkout` (admin/cashier/supervisor), none of whom besides admin hold
    // `products.update`. `result.order` uses this module's own gate; `result.sale` reuses
    // `SalesService.stripSaleCostForViewer()` (the exact same `canViewCost()`/`stripSaleCost()`
    // gate `SalesService.create()`/`findAll()`/`findOne()` already enforce) rather than
    // reimplementing it here.
    return {
      order: canViewOrderCost(viewerPermissions) ? result.order : this.stripOrderItemsCost(result.order),
      sale: this.salesService.stripSaleCostForViewer(result.sale, viewerPermissions),
    };
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

    const fee = order.deliveryFee == null ? null : Number(order.deliveryFee);
    const hasCalculationSnapshot =
      Boolean(order.deliveryCalculationVersion?.trim()) &&
      order.deliveryPricingBreakdown != null;

    // SOFIA Address Remediation — single source of truth. This MUST reconstruct the canonical
    // checkout-authorization contract via deriveCheckoutAuthorizationFromOrderSnapshot() (the same
    // pure function DeliveryPricingEngine uses at live-quote time, via
    // deriveCheckoutAuthorization()) rather than re-deriving its own notion of "can checkout" from
    // deliveryPricingStatus. A LOCAL_FREE zone match with an incomplete address is never sufficient
    // by itself — see delivery-checkout-authorization.ts and CLAUDE.md mandatory rules 1/2/6.
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: order.deliveryPricingStatus,
      deliveryRequiresManualQuote: order.deliveryRequiresManualQuote,
      deliveryFee: fee,
      hasCalculationSnapshot,
    });

    // Deliberately no additional/parallel checks here: authorization.canCheckout already folds in
    // hasCalculationSnapshot, deliveryRequiresManualQuote and fee validity (see
    // deriveCheckoutAuthorizationFromOrderSnapshot). Re-testing those fields independently here
    // would recreate exactly the "diverging parallel rule" failure mode this remediation closes.
    if (!authorization.canCheckout) {
      throw new BadRequestException('El domicilio requiere una tarifa automática válida antes de cobrar.');
    }
  }

  async reopen(id: string, dto: ReopenOrderTicketDto, actorId: string, viewerPermissions?: string[]) {
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
      // Revalidate after acquiring the row lock so concurrent reopen requests cannot
      // both apply cash and stock reversals from the same paid order.
      await tx.$queryRaw`
        SELECT id
        FROM order_tickets
        WHERE id = ${id}
        FOR UPDATE
      `;
      const lockedOrder = await tx.orderTicket.findUnique({
        where: { id },
        select: {
          status: true,
          sale: {
            select: { status: true },
          },
        },
      });
      if (!lockedOrder || lockedOrder.status !== OrderTicketStatus.PAID) {
        throw new BadRequestException('Solo una comanda ya cobrada se puede reabrir.');
      }
      if (!lockedOrder.sale || lockedOrder.sale.status !== SaleStatus.PAID) {
        throw new BadRequestException('La comanda no tiene una venta pagada activa para revertir.');
      }

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

      await this.auditService.log(
        {
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
            status: reopenedOrder.status,
            reason,
          },
        },
        tx,
      );

      return reopenedOrder;
    });

    this.realtimeService.publishOrderUpdated({
      entityId: result.id,
      orderType: result.type,
      status: result.status,
      actorId,
    });
    this.realtimeService.publishOperationalRefresh('all');

    // A73 (CRITICAL, blind red-team finding): POST /orders/:id/reopen returned the raw
    // `orderInclude`-shaped order — including `items[].product.costPrice` — to any caller holding
    // `orders.update` (admin/cashier/supervisor), none of whom besides admin hold
    // `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return {
      success: true,
      orderTicket: canViewOrderCost(viewerPermissions) ? result : this.stripOrderItemsCost(result),
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

  /**
   * SOFIA Round 5 / A55 CLOSURE (CRITICAL, A54 blind red-team finding) — `item.unitPrice` is a
   * CLIENT-SUPPLIED number that must NEVER be trusted as the actual charged price unless the
   * acting operator independently holds price-setting authority. Before this fix, every caller
   * (`create`, `replaceItems`, `syncWaiterOrder` — all reachable by the `waiter` role, which
   * deliberately holds no `orders.checkout`/`cash.*`/discount permission) trusted
   * `item.unitPrice ?? product.salePrice` verbatim, letting `waiter` set any item's persisted,
   * later-checked-out price to anything (down to 0).
   *
   * Investigation confirmed a LEGITIMATE existing use of client-supplied `unitPrice`: the POS
   * screen (`apps/web/src/app/(app)/pos/page.tsx`, `updateItemPrice`) lets a privileged operator
   * (admin/cashier/supervisor — never waiter) manually override an item's price before
   * create/replaceItems, using the SAME shared DTO field. Removing the field entirely (blanket
   * Option A) would have broken that real feature, so the fix instead gates trust behind
   * `isPrivilegedOrderOperator(actor)` — the SAME admin/cashier/supervisor-vs-waiter boundary
   * this file already uses elsewhere (see `assertWaiterCanOperateTable` call sites) — and reuses
   * the existing generic `AuditService`/`AuditLog` (no new column, no migration) to record any
   * actual override (who/when/product/catalog price/overridden price), mirroring the
   * `deliveryFeeEdited`/`deliveryFeeEditReason` audit pattern used for delivery-fee overrides.
   *
   * `trustProvidedUnitPrice`:
   *  - `false` (waiter, or any non-privileged role): `item.unitPrice` is ALWAYS ignored;
   *    `product.salePrice` is the sole source of truth for the persisted/charged price.
   *  - `true` (admin/cashier/supervisor via `create`/`replaceItems`/`syncWaiterOrder`, OR the
   *    internal `createFromCanonicalCheckout` call whose `itemSnapshots` are already
   *    server-derived from `product.persistedPrice` by SOFIA's commercial authority, never raw
   *    client input): `item.unitPrice` is honored when present, exactly as before.
   */
  private async buildOrderItems(
    tx: Prisma.TransactionClient,
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice?: number;
      notes?: string;
      modifiersSnapshot?: Prisma.InputJsonValue;
    }>,
    options: { trustProvidedUnitPrice: boolean },
  ) {
    const result: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
      notes?: string;
      modifiersSnapshot?: Prisma.InputJsonValue;
    }> = [];
    const priceOverrides: Array<{
      productId: string;
      productName: string;
      catalogUnitPrice: number;
      overriddenUnitPrice: number;
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
      const catalogUnitPrice = toDecimal(product.salePrice);
      const providedUnitPrice =
        options.trustProvidedUnitPrice && item.unitPrice !== undefined && item.unitPrice !== null
          ? toDecimal(item.unitPrice)
          : null;
      const unitPrice = providedUnitPrice ?? catalogUnitPrice;
      const totalPrice = quantity.mul(unitPrice);

      if (providedUnitPrice && !providedUnitPrice.equals(catalogUnitPrice)) {
        priceOverrides.push({
          productId: product.id,
          productName: product.name,
          catalogUnitPrice: toNumber(catalogUnitPrice),
          overriddenUnitPrice: toNumber(providedUnitPrice),
        });
      }

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
        modifiersSnapshot: item.modifiersSnapshot,
      });
    }

    return { items: result, priceOverrides };
  }

  /**
   * SOFIA Round 5 / A55 CLOSURE: writes one `AuditLog` row per manual item-price override so a
   * privileged operator's (admin/cashier/supervisor) decision to charge something other than
   * `product.salePrice` is never silent, mirroring the `deliveryFeeEdited`/`deliveryFeeEditReason`
   * audit pattern used for delivery-fee overrides. No-op when there are no overrides.
   */
  private async auditItemPriceOverrides(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    orderId: string,
    overrides: Array<{
      productId: string;
      productName: string;
      catalogUnitPrice: number;
      overriddenUnitPrice: number;
    }>,
  ) {
    for (const override of overrides) {
      await this.auditService.log(
        {
          userId: actor.sub,
          actorRole: actor.roles.join(','),
          action: 'ORDER_ITEM_PRICE_OVERRIDDEN',
          module: 'orders',
          entity: 'order_ticket_item',
          entityId: orderId,
          newValues: {
            productId: override.productId,
            productName: override.productName,
            catalogUnitPrice: override.catalogUnitPrice,
            overriddenUnitPrice: override.overriddenUnitPrice,
          },
        },
        tx,
      );
    }
  }

  private parseCanonicalCheckoutItems(value: Prisma.JsonValue) {
    if (!Array.isArray(value) || !value.length) {
      throw new BadRequestException('El checkout no contiene productos válidos.');
    }
    return value.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException('El checkout contiene un producto inválido.');
      }
      const item = raw as Record<string, unknown>;
      const productId = typeof item.productId === 'string' ? item.productId : '';
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException('El checkout contiene cantidades o precios inválidos.');
      }
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      return {
        productId,
        quantity,
        unitPrice,
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 240) : undefined,
        modifiersSnapshot: modifiers as Prisma.InputJsonValue,
      };
    });
  }

  private async applyDeliveryLocationForLogisticsOnly(
    order: Parameters<OrdersService['applyDeliveryLocationForLogisticsOnlyInTransaction']>[1],
    latitude: number,
    longitude: number,
    actorId?: string,
  ) {
    return this.prisma.$transaction((tx) =>
      this.applyDeliveryLocationForLogisticsOnlyInTransaction(
        tx,
        order,
        latitude,
        longitude,
        actorId,
      ),
    );
  }

  private async applyDeliveryLocationForLogisticsOnlyInTransaction(
    tx: Prisma.TransactionClient,
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

    // SOFIA Round 5 / A14 CLOSURE (legacy POS symmetric gap to the A13 SOFIA finding): this
    // "logistics only" path is the courier-live-location-tracking path — by design it must NOT
    // silently change a fee/total the customer already agreed to or paid for (see
    // `pricingPreserved`/`feeChanged: false` in the audit/alert metadata below), so it deliberately
    // never calls `resolveDeliverySnapshot`/repricing. That is correct once the order is genuinely
    // in courier-dispatch territory. But `ACTIVE_ORDER_STATUSES` (this function's callers match
    // orders in OPEN/IN_PREPARATION/SERVED/PAYMENT_PENDING too — i.e. BEFORE `checkout()` has ever
    // run) means the SAME "preserve pricing" behavior can also fire on an order that has not been
    // checked out yet. `assertDeliveryCheckoutAllowed()` (see below) reads ONLY the persisted
    // `deliveryPricingStatus`/`deliveryFee`/`deliveryCalculationVersion` columns — it has no idea
    // the coordinates underneath that price snapshot just moved. Without this guard, a courier's
    // live-location share landing between order creation and checkout could silently replace a
    // NEAR (cheap/in-coverage) pair with a FAR (genuinely out-of-coverage) one and the order would
    // still check out at the stale price — the exact class of bug A13 found in SOFIA's `confirm()`.
    //
    // Fix: if the order has NOT yet been checked out AND already has a resolved pricing snapshot
    // AND the new coordinates are materially different (same threshold/helper the canonical
    // destination-state module uses for SOFIA's quote binding — `isCoordinateEvidenceMateriallyDifferent`,
    // never a second independently-invented notion of "different enough") from whatever coordinates
    // that snapshot was actually computed against, mark the EXISTING `deliveryRequiresManualQuote`
    // column `true`. That column is already the canonical "address not complete enough to check out"
    // signal consumed by `deriveCheckoutAuthorizationFromOrderSnapshot()` (see
    // `delivery-checkout-authorization.ts`) — reusing it means `assertDeliveryCheckoutAllowed()`
    // fails closed with ZERO changes required there, and the ONLY way to clear it is a real
    // repricing pass through `resolveDeliverySnapshot` (i.e. `update()`), never a silent bypass.
    // Once genuinely checked out (PAID/CANCELLED), pricing must stay preserved unconditionally —
    // this guard is a no-op for those statuses, exactly matching the intended courier-tracking use.
    const isPrePayment = ACTIVE_ORDER_STATUSES.includes(order.status);
    const hasExistingPricingSnapshot =
      Boolean(order.deliveryCalculationVersion?.trim()) && order.deliveryPricingBreakdown != null;
    // SOFIA Round 5 / A16 CLOSURE (CRITICAL, A15 blind red team finding): compared against
    // `order.deliveryLatitude`/`deliveryLongitude` before A16 — but THIS SAME transaction overwrites
    // those columns with the raw incoming ping a few lines below on EVERY call, whether or not a real
    // repricing happens. That made "previous" a WALKING reference (the last-applied hop), not the
    // FIXED point the currently-active price was actually computed against — a sequence of hops each
    // individually under `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` relative to the PREVIOUS hop
    // could cumulatively drift the destination arbitrarily far without ever tripping this check (A15:
    // 70 hops, ~9.7km cumulative drift, `deliveryRequiresManualQuote` never set). Anchor to the
    // coordinate pair `resolvePricedAnchorCoordinates` recovers from the last REAL repricing pass's
    // linked `DeliveryPricingAudit` row instead — a value logistics-only pings can never move.
    let coordinatesMateriallyDifferent = false;
    if (isPrePayment && hasExistingPricingSnapshot) {
      const anchor = await this.resolvePricedAnchorCoordinates(tx, order);
      coordinatesMateriallyDifferent = anchor.anchorFound
        ? isCoordinateEvidenceMateriallyDifferent(anchor.latitude, anchor.longitude, latitude, longitude)
        : true; // fail closed: a real price exists but its anchor could not be recovered
    }
    const requiresRequoteBeforeCheckout = isPrePayment && hasExistingPricingSnapshot && coordinatesMateriallyDifferent;

    const updatedOrder = await tx.orderTicket.update({
      where: { id: order.id },
      data: {
        deliveryLatitude: new Prisma.Decimal(latitude),
        deliveryLongitude: new Prisma.Decimal(longitude),
        deliveryLocationSource: 'whatsapp_live_location',
        deliveryLocationReceivedAt: new Date(),
        deliveryCustomerId,
        deliveryStatusUpdatedAt: new Date(),
        revision: { increment: 1 },
        ...(requiresRequoteBeforeCheckout ? { deliveryRequiresManualQuote: true } : {}),
      },
      include: orderInclude,
    });

    await this.auditService.log(
      {
        userId: actorId || undefined,
        action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
        module: 'orders',
        entity: 'order_ticket',
        entityId: updatedOrder.id,
        oldValues: {
          locationPresent: Boolean(order.deliveryLatitude && order.deliveryLongitude),
          subtotal: order.items.reduce((sum, item) => sum.add(item.totalPrice), new Prisma.Decimal(0))
            .add(order.deliveryFee ?? 0),
          deliveryFee: order.deliveryFee,
        },
        newValues: {
          phoneMasked: this.maskPhoneForAudit(order.customerPhone),
          latitude,
          longitude,
          locationPresent: true,
          source: 'whatsapp_location',
          // Note: `pricingPreserved`/`feeChanged`/`totalChanged` describe the persisted `deliveryFee`
          // NUMBER (never mutated by this logistics-only path). `requiresRequoteBeforeCheckout`
          // (SOFIA Round 5 / A14) is the separate, safety-relevant signal: `true` means the new
          // coordinate evidence was materially different from what that unchanged fee was actually
          // computed against, and `deliveryRequiresManualQuote` was flipped so checkout is blocked
          // (via the existing `assertDeliveryCheckoutAllowed` gate) until a real repricing pass runs.
          pricingPreserved: true,
          feeChanged: false,
          totalChanged: false,
          requiresRequoteBeforeCheckout,
          locationSavedForDelivery: true,
          subtotal: updatedOrder.subtotal,
          deliveryFee: updatedOrder.deliveryFee,
        },
      },
      tx,
    );

    return updatedOrder;
  }

  async captureDeliveryLocationFromWhatsapp(input: {
    sourceEventKey?: string | null;
    payloadHash?: string | null;
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

    let inbox;
    try {
      inbox = await this.prisma.deliveryLocationInbox.create({
        data: {
          sourceEventKey: input.sourceEventKey ?? null,
          payloadHash: input.payloadHash ?? null,
          rawSenderJid: this.maskWhatsappIdentifier(input.rawSenderJid),
          participantJid: this.maskWhatsappIdentifier(input.participantJid),
          remoteJid: this.maskWhatsappIdentifier(input.remoteJid),
          normalizedSenderPhone: this.maskPhoneForAudit(normalizedCandidates[0]),
          latitude: toDecimal(input.latitude),
          longitude: toDecimal(input.longitude),
          rawPayload: input.rawPayload ?? undefined,
        },
      });
    } catch (error) {
      if (!input.sourceEventKey || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const replay = await this.prisma.deliveryLocationInbox.findUniqueOrThrow({
        where: { sourceEventKey: input.sourceEventKey },
        include: { matchedOrder: { include: orderInclude } },
      });
      if (replay.payloadHash && input.payloadHash && replay.payloadHash !== input.payloadHash) {
        throw new ConflictException('La identidad del evento de ubicación no coincide con su contenido.');
      }
      if (replay.processedAt) {
        const alert = await this.prisma.operationalAlert.findFirst({
          where: { deliveryLocationInboxId: replay.id },
          orderBy: { createdAt: 'desc' },
        });
        return {
          inbox: replay,
          order: replay.matchedOrder,
          alert,
          matchedRule: replay.matchedRule,
        };
      }
      inbox = replay;
    }

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
      const { unresolved, alert } = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-location:${inbox.id}`}, 0))
        `;
        const currentInbox = await tx.deliveryLocationInbox.findUniqueOrThrow({ where: { id: inbox.id } });
        const unresolved = currentInbox.processedAt
          ? currentInbox
          : await tx.deliveryLocationInbox.update({
              where: { id: currentInbox.id, version: currentInbox.version },
              data: {
                version: { increment: 1 },
                matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
                processingNotes: 'No fue posible correlacionar automáticamente la ubicación con una comanda activa.',
                processedAt: new Date(),
              },
            });
        let alert = await tx.operationalAlert.findFirst({
          where: {
            type: 'DELIVERY_LOCATION_PENDING_REVIEW',
            deliveryLocationInboxId: unresolved.id,
          },
        });
        if (!alert) {
          alert = await tx.operationalAlert.create({
            data: {
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
                senderIdentitiesMasked: normalizedCandidates
                  .map((candidate) => this.maskPhoneForAudit(candidate))
                  .filter(Boolean),
                valuesSanitized: true,
              },
            },
          });
        }
        return { unresolved, alert };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      this.publishOperationalAlert(alert);

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

    if (
      this.deliveryLocationConflicts(
        matched.order.deliveryLatitude,
        matched.order.deliveryLongitude,
        input.latitude,
        input.longitude,
      )
    ) {
      const { conflicted, alert } = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-location:${inbox.id}`}, 0))
        `;
        const currentInbox = await tx.deliveryLocationInbox.findUniqueOrThrow({ where: { id: inbox.id } });
        const conflicted = currentInbox.processedAt
          ? currentInbox
          : await tx.deliveryLocationInbox.update({
              where: { id: currentInbox.id, version: currentInbox.version },
              data: {
                version: { increment: 1 },
                matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
                matchedOrderId: matched.order.id,
                matchedCustomerId: matched.order.deliveryCustomerId ?? null,
                matchedRule: 'coordinate_conflict',
                processingNotes: 'La ubicación recibida difiere de las coordenadas comerciales confirmadas.',
                processedAt: new Date(),
              },
            });
        let alert = await tx.operationalAlert.findFirst({
          where: {
            type: 'DELIVERY_LOCATION_PENDING_REVIEW',
            deliveryLocationInboxId: conflicted.id,
          },
        });
        if (!alert) {
          alert = await tx.operationalAlert.create({
            data: {
              type: 'DELIVERY_LOCATION_PENDING_REVIEW',
              module: 'deliveries',
              severity: OperationalAlertSeverity.WARNING,
              title: 'Ubicación distinta a la dirección confirmada',
              message: 'La ubicación logística no coincide con las coordenadas comerciales. Requiere revisión sin alterar tarifa ni total.',
              entityType: 'delivery_location_inbox',
              entityId: conflicted.id,
              actorId: input.actorId ?? null,
              deliveryLocationInboxId: conflicted.id,
              metadata: {
                matchedOrderId: matched.order.id,
                conflict: 'COMMERCIAL_COORDINATES_MISMATCH',
                pricingPreserved: true,
                feeChanged: false,
                totalChanged: false,
              },
            },
          });
        }
        return { conflicted, alert };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.publishOperationalAlert(alert);
      this.realtimeService.publishDeliveryLocationPending({
        inboxId: conflicted.id,
        reason: 'commercial_coordinates_conflict',
        actorId: input.actorId ?? null,
      });
      return { inbox: conflicted, order: null, alert, matchedRule: 'coordinate_conflict' };
    }

    let applied;
    try {
      applied = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.deliveryLocationInbox.updateMany({
          where: {
            id: inbox.id,
            version: inbox.version,
            matchStatus: DeliveryLocationInboxStatus.PENDING,
            processedAt: null,
          },
          data: { version: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new ConflictException('DELIVERY_LOCATION_EVENT_ALREADY_PROCESSING');

        const order = matched.order!;
        const updated = await this.applyDeliveryLocationForLogisticsOnlyInTransaction(
          tx,
          order,
          input.latitude,
          input.longitude,
          input.actorId ?? undefined,
        );
        const appliedInbox = await tx.deliveryLocationInbox.update({
          where: { id: inbox.id, version: inbox.version + 1 },
          data: {
            matchStatus: DeliveryLocationInboxStatus.APPLIED,
            matchedOrderId: updated.id,
            matchedCustomerId: updated.deliveryCustomerId ?? null,
            matchedRule: matched.rule,
            processingNotes: `Ubicación aplicada automáticamente a ${updated.number}.`,
            processedAt: new Date(),
          },
        });
        const infoAlert = await tx.operationalAlert.create({
          data: {
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
          },
        });
        return { updated, appliedInbox, infoAlert };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!input.sourceEventKey || !(error instanceof ConflictException || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'))) {
        throw error;
      }
      const replay = await this.prisma.deliveryLocationInbox.findUniqueOrThrow({
        where: { sourceEventKey: input.sourceEventKey },
        include: { matchedOrder: { include: orderInclude } },
      });
      if (!replay.processedAt) throw new ConflictException('DELIVERY_LOCATION_EVENT_ALREADY_PROCESSING');
      const alert = await this.prisma.operationalAlert.findFirst({
        where: { deliveryLocationInboxId: replay.id },
        orderBy: { createdAt: 'desc' },
      });
      return { inbox: replay, order: replay.matchedOrder, alert, matchedRule: replay.matchedRule };
    }
    const { updated, appliedInbox, infoAlert } = applied;
    this.publishOperationalAlert(infoAlert);

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
    if (!input.ignore && !input.orderId) {
      throw new BadRequestException('Selecciona una comanda para aplicar la ubicación pendiente.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-location:${id}`}, 0))
      `;
      const inbox = await tx.deliveryLocationInbox.findUnique({ where: { id } });
      if (!inbox) throw new NotFoundException('No se encontró la ubicación pendiente.');

      if (input.ignore) {
        if (inbox.matchStatus === DeliveryLocationInboxStatus.IGNORED) {
          return { kind: 'IGNORED' as const, inbox, resolvedAlerts: [] };
        }
        if (inbox.matchStatus === DeliveryLocationInboxStatus.APPLIED) {
          throw new ConflictException('La ubicación ya fue aplicada y no puede ignorarse.');
        }
        const ignored = await tx.deliveryLocationInbox.update({
          where: { id: inbox.id, version: inbox.version },
          data: {
            version: { increment: 1 },
            matchStatus: DeliveryLocationInboxStatus.IGNORED,
            processingNotes: input.notes?.trim() || 'Marcada como ignorada por operación.',
            processedAt: new Date(),
          },
        });
        const resolvedAlerts = await this.resolveOperationalAlertsInTransaction(tx, {
          module: 'deliveries',
          entityType: 'delivery_location_inbox',
          entityId: ignored.id,
          types: ['DELIVERY_LOCATION_PENDING_REVIEW'],
          resolvedById: actor.sub,
        });
        return { kind: 'IGNORED' as const, inbox: ignored, resolvedAlerts };
      }

      if (inbox.matchStatus === DeliveryLocationInboxStatus.APPLIED) {
        if (inbox.matchedOrderId !== input.orderId) {
          throw new ConflictException('La ubicación ya fue aplicada a otra comanda.');
        }
        const order = await tx.orderTicket.findUniqueOrThrow({
          where: { id: inbox.matchedOrderId },
          include: orderInclude,
        });
        const alert = await tx.operationalAlert.findFirst({
          where: { type: 'DELIVERY_LOCATION_RECEIVED', deliveryLocationInboxId: inbox.id },
        });
        return { kind: 'APPLIED' as const, inbox, order, alert, resolvedAlerts: [] };
      }

      if (
        inbox.matchStatus === DeliveryLocationInboxStatus.REQUIRES_REVIEW &&
        inbox.matchedRule === 'coordinate_conflict' &&
        inbox.matchedOrderId === input.orderId
      ) {
        const alert = await tx.operationalAlert.findFirst({
          where: { type: 'DELIVERY_LOCATION_PENDING_REVIEW', deliveryLocationInboxId: inbox.id },
        });
        return { kind: 'CONFLICT' as const, inbox, order: null, alert, resolvedAlerts: [] };
      }

      const order = await tx.orderTicket.findUnique({
        where: { id: input.orderId! },
        include: orderInclude,
      });
      if (!order) throw new NotFoundException('No se encontró la comanda seleccionada.');
      this.assertDeliveryOrder(order);

      if (
        this.deliveryLocationConflicts(
          order.deliveryLatitude,
          order.deliveryLongitude,
          Number(inbox.latitude),
          Number(inbox.longitude),
        )
      ) {
        const conflicted = await tx.deliveryLocationInbox.update({
          where: { id: inbox.id, version: inbox.version },
          data: {
            version: { increment: 1 },
            matchStatus: DeliveryLocationInboxStatus.REQUIRES_REVIEW,
            matchedOrderId: order.id,
            matchedCustomerId: order.deliveryCustomerId ?? null,
            matchedRule: 'coordinate_conflict',
            processingNotes: 'La ubicación recibida difiere de las coordenadas comerciales confirmadas.',
            processedAt: new Date(),
          },
        });
        let alert = await tx.operationalAlert.findFirst({
          where: { type: 'DELIVERY_LOCATION_PENDING_REVIEW', deliveryLocationInboxId: inbox.id },
        });
        if (!alert) {
          alert = await tx.operationalAlert.create({
            data: {
              type: 'DELIVERY_LOCATION_PENDING_REVIEW',
              module: 'deliveries',
              severity: OperationalAlertSeverity.WARNING,
              title: 'Ubicación distinta a la dirección confirmada',
              message: 'La ubicación requiere revisión y no modificó la tarifa ni el total comercial.',
              entityType: 'delivery_location_inbox',
              entityId: inbox.id,
              actorId: actor.sub,
              deliveryLocationInboxId: inbox.id,
              metadata: {
                matchedOrderId: order.id,
                conflict: 'COMMERCIAL_COORDINATES_MISMATCH',
                pricingPreserved: true,
                feeChanged: false,
                totalChanged: false,
              },
            },
          });
        }
        return { kind: 'CONFLICT' as const, inbox: conflicted, order: null, alert, resolvedAlerts: [] };
      }

      const claimed = await tx.deliveryLocationInbox.updateMany({
        where: {
          id: inbox.id,
          version: inbox.version,
          matchStatus: { in: [DeliveryLocationInboxStatus.PENDING, DeliveryLocationInboxStatus.REQUIRES_REVIEW] },
        },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ConflictException('STALE_DELIVERY_LOCATION_INBOX_VERSION');

      const updatedOrder = await this.applyDeliveryLocationForLogisticsOnlyInTransaction(
        tx,
        order,
        Number(inbox.latitude),
        Number(inbox.longitude),
        actor.sub,
      );
      const resolvedInbox = await tx.deliveryLocationInbox.update({
        where: { id: inbox.id, version: inbox.version + 1 },
        data: {
          matchStatus: DeliveryLocationInboxStatus.APPLIED,
          matchedOrderId: updatedOrder.id,
          matchedCustomerId: updatedOrder.deliveryCustomerId ?? null,
          matchedRule: 'manual_resolution',
          processingNotes: input.notes?.trim() || `Ubicación aplicada manualmente a ${updatedOrder.number}.`,
          processedAt: new Date(),
        },
      });
      const resolvedAlerts = await this.resolveOperationalAlertsInTransaction(tx, {
        module: 'deliveries',
        entityType: 'delivery_location_inbox',
        entityId: resolvedInbox.id,
        types: ['DELIVERY_LOCATION_PENDING_REVIEW'],
        resolvedById: actor.sub,
      });
      let alert = await tx.operationalAlert.findFirst({
        where: { type: 'DELIVERY_LOCATION_RECEIVED', deliveryLocationInboxId: resolvedInbox.id },
      });
      if (!alert) {
        alert = await tx.operationalAlert.create({
          data: {
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
          },
        });
      }
      return { kind: 'APPLIED' as const, inbox: resolvedInbox, order: updatedOrder, alert, resolvedAlerts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    for (const alert of result.resolvedAlerts) {
      this.publishOperationalAlert({ ...alert, status: OperationalAlertStatus.RESOLVED });
    }
    if (result.kind === 'IGNORED') {
      this.realtimeService.publishOperationalRefresh('all');
      return result.inbox;
    }
    if (result.alert) this.publishOperationalAlert(result.alert);
    if (result.kind === 'CONFLICT') {
      this.realtimeService.publishDeliveryLocationPending({
        inboxId: result.inbox.id,
        reason: 'commercial_coordinates_conflict',
        actorId: actor.sub,
      });
      this.realtimeService.publishOperationalRefresh('all');
      return { inbox: result.inbox, order: null };
    }
    this.realtimeService.publishDeliveryLocationReceived({
      entityId: result.order.id,
      inboxId: result.inbox.id,
      actorId: actor.sub,
    });
    this.realtimeService.publishOrderUpdated({
      entityId: result.order.id,
      orderType: result.order.type,
      status: result.order.status,
      actorId: actor.sub,
    });
    this.realtimeService.publishOperationalRefresh('all');
    // A73 (CRITICAL, blind red-team finding): POST /orders/delivery-location-inbox/:id/resolve
    // returned the raw `orderInclude`-shaped order — including `items[].product.costPrice` — to
    // any caller holding `delivery.update` (admin/cashier/supervisor), none of whom besides admin
    // hold `products.update`. Same gate as findAll()/findOne() (A69/A70).
    return {
      inbox: result.inbox,
      order: canViewOrderCost(actor.permissions) ? result.order : this.stripOrderItemsCost(result.order),
    };
  }

  async listOperationalAlerts(module?: string) {
    // A56/A57: this route must never surface alerts outside its allowlisted modules (see
    // ORDERS_OPERATIONAL_ALERT_MODULES) — in particular never `module: 'sofia'`, which is
    // admin/supervisor-only data owned by the dedicated /admin/sofia/alerts route.
    if (module && !OrdersService.ORDERS_OPERATIONAL_ALERT_MODULES.includes(module)) {
      throw new ForbiddenException('No tiene acceso a alertas operativas de este módulo.');
    }
    return this.prisma.operationalAlert.findMany({
      where: {
        module: module ? module : { in: [...OrdersService.ORDERS_OPERATIONAL_ALERT_MODULES] },
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

    // A56/A57: mirror the read-side module allowlist so this route can never mutate an alert
    // (e.g. silently RESOLVE a SOFIA governance alert) that belongs to a module it is not
    // authorized to touch — closing the same cross-module RBAC gap for writes.
    if (!OrdersService.ORDERS_OPERATIONAL_ALERT_MODULES.includes(current.module)) {
      throw new ForbiddenException('No tiene acceso a alertas operativas de este módulo.');
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

  private maskWhatsappIdentifier(identifier?: string | null) {
    if (!identifier) return null;
    const [local, domain] = identifier.split('@', 2);
    const maskedLocal = this.maskPhoneForAudit(local);
    return maskedLocal ? `${maskedLocal}${domain ? `@${domain}` : ''}` : '[REDACTED_IDENTIFIER]';
  }

  /**
   * SOFIA Address Remediation — Round 5 / A11 CLOSURE (legacy POS). Maps a legacy POS
   * `deliveryLocationSource`/`deliveryLocationProvider` input string onto A9's canonical
   * `CoordinateSource` enum. Legacy POS has never distinguished coordinate PROVENANCE as its own
   * axis (unlike SOFIA's explicit `GPS_SHARE` literal) — it only ever passed through whatever
   * free-text `deliveryLocationProvider` the POS UI's address picker supplied (a geocoder/
   * autocomplete provider id) or nothing at all (historically defaulted to
   * `'whatsapp_live_location'`). This mapping is intentionally forgiving (never throws) because it
   * only feeds `coordinateTrust` (TRUSTED vs PROVISIONAL) — both are used for pricing via
   * `isCoordinateProvisionallyUsable` below, so misclassifying the exact provenance here can never
   * by itself reopen a coverage/pricing gap; only the atomic-pair and revision/staleness rules
   * (enforced by `applyDestinationEdit`) are safety-load-bearing.
   */
  private resolveLegacyCoordinateSource(
    locationSource?: string | null,
    locationProvider?: string | null,
  ): CoordinateSource {
    const raw = (locationSource ?? locationProvider ?? '').trim().toLowerCase();
    if (!raw) return 'GPS_SHARE'; // legacy default: an unlabeled coordinate pair historically meant a live location share
    if (raw.includes('live_location') || raw.includes('gps')) return 'GPS_SHARE';
    if (raw.includes('map_pin') || raw.includes('pin')) return 'MAP_PIN';
    if (raw.includes('manual')) return 'MANUAL_ENTRY';
    if (raw.includes('history')) return 'CUSTOMER_HISTORY';
    if (raw === 'address_zone_estimate') return 'UNKNOWN';
    // Any other named provider (e.g. a geocoding/autocomplete provider id selected from the POS
    // address picker) is provider-verified evidence, not raw manual entry.
    return 'GEOCODED_ADDRESS';
  }

  /**
   * SOFIA Round 5 / A18 CLOSURE — companion to `resolveDeliverySnapshot`'s call site in `update()`.
   * Returns the delivery* columns EXACTLY as currently persisted, with no re-derivation and no
   * pricing call. Used when an `update()` DTO carries no address-relevant field at all, so the
   * edit (notes, items, status, etc.) must never be allowed to re-anchor or re-price the order —
   * see the `hasAddressRelevantInput` comment at the `update()` call site for the full rationale.
   * Shape matches `resolveDeliverySnapshot`'s return value field-for-field so both can feed the
   * same downstream `data`/`subtotal` construction without a caller-side branch.
   */
  private carryForwardDeliverySnapshot(current: {
    deliveryCustomerId: string | null;
    deliveryReference: string | null;
    deliveryAddressNormalized: string | null;
    deliveryLatitude: Prisma.Decimal | null;
    deliveryLongitude: Prisma.Decimal | null;
    deliveryDistanceKm: Prisma.Decimal | null;
    deliveryZoneLabel: string | null;
    deliveryFee: Prisma.Decimal;
    deliveryFeeSuggested: Prisma.Decimal | null;
    deliveryFeeEdited: boolean;
    deliveryFeeEditReason: string | null;
    deliveryPricingStatus: string | null;
    deliveryPricingConfidence: string | null;
    deliveryPricingBreakdown: Prisma.JsonValue | null;
    deliveryCalculationVersion: string | null;
    deliveryRequiresManualQuote: boolean;
    deliveryRouteProvider: string | null;
    deliveryWeatherProvider: string | null;
    deliveryGeocodingProvider: string | null;
    deliveryEstimatedMinutes: Prisma.Decimal | null;
    deliveryLocationSource: string | null;
    deliveryLocationReceivedAt: Date | null;
  }) {
    return {
      deliveryCustomerId: current.deliveryCustomerId,
      deliveryReference: current.deliveryReference,
      deliveryAddressNormalized: current.deliveryAddressNormalized,
      deliveryLatitude: current.deliveryLatitude,
      deliveryLongitude: current.deliveryLongitude,
      deliveryDistanceKm: current.deliveryDistanceKm,
      deliveryZoneLabel: current.deliveryZoneLabel,
      deliveryFee: current.deliveryFee,
      deliveryFeeSuggested: current.deliveryFeeSuggested,
      deliveryFeeEdited: current.deliveryFeeEdited,
      deliveryFeeEditReason: current.deliveryFeeEditReason,
      deliveryPricingStatus: current.deliveryPricingStatus,
      deliveryPricingConfidence: current.deliveryPricingConfidence,
      deliveryPricingBreakdown: (current.deliveryPricingBreakdown ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      deliveryCalculationVersion: current.deliveryCalculationVersion,
      deliveryRequiresManualQuote: current.deliveryRequiresManualQuote,
      deliveryRouteProvider: current.deliveryRouteProvider,
      deliveryWeatherProvider: current.deliveryWeatherProvider,
      deliveryGeocodingProvider: current.deliveryGeocodingProvider,
      deliveryEstimatedMinutes: current.deliveryEstimatedMinutes,
      // No new pricing audit row was created — nothing to link. `update()`'s
      // `deliverySnapshot?.deliveryPricingAuditId` linking step is a no-op for this branch.
      deliveryPricingAuditId: null as string | null,
      deliveryLocationSource: current.deliveryLocationSource,
      deliveryLocationReceivedAt: current.deliveryLocationReceivedAt,
    };
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

    // SOFIA Round 5 / A11 CLOSURE (CRITICAL, A8 finding): `resolveDeliverySnapshot` used to
    // maintain its OWN independent notion of "did the address change" (`referenceChanged`, a bare
    // normalized-text inequality check) and independently decide whether to keep or discard
    // existing coordinates. ANY text change — including a purely non-spatial instruction edit like
    // "casa azul" -> "portón negro" — was treated as address-invalidating, discarding trusted
    // coordinates that had already proven a destination ~42km away, after which the coordinate-less
    // order could be re-priced from bare textual zone matching, silently reopening LOCAL_FREE. This
    // now reconstructs the destination as a canonical `DestinationSnapshot` (A9) from whatever is
    // currently persisted on the order row, and routes the edit through the SAME single
    // `applyDestinationEdit` state-transition function SOFIA (A10) uses — no independent per-axis
    // fallback logic remains here.
    const previousSnapshot: DestinationSnapshot | null = input.existing
      ? fromOrderTicketDeliveryColumns({
          deliveryReference: input.existing.deliveryReference ?? null,
          deliveryAddressNormalized: input.existing.deliveryAddressNormalized ?? null,
          deliveryLatitude: input.existing.deliveryLatitude ?? null,
          deliveryLongitude: input.existing.deliveryLongitude ?? null,
          deliveryLocationSource: input.existing.deliveryLocationSource ?? null,
          deliveryLocationReceivedAt: input.existing.deliveryLocationReceivedAt
            ? new Date(input.existing.deliveryLocationReceivedAt)
            : null,
          deliveryGeocodingProvider: input.existing.deliveryGeocodingProvider ?? null,
        })
      : null;

    // RULE 1 (coordinate atomicity) at the legacy single-combined-DTO boundary: `deliveryLatitude`
    // and `deliveryLongitude` are independently `@IsOptional()` on the create/update DTOs (no
    // cross-field validator), so a caller can submit exactly ONE axis. That partial axis is never
    // treated as coordinate evidence for this turn at all — it is neither fabricated into a hybrid
    // pair with a leftover old axis (the round-4 finding) NOR allowed to discard a previously-valid
    // pair that this edit otherwise leaves untouched (RULE 3: "never silently discard a
    // previously-valid pair just because one axis wasn't resupplied on an otherwise non-spatial
    // edit"). Whatever `applyDestinationEdit` decides about the EXISTING pair (preserve on
    // NON_SPATIAL, stale on SPATIAL) governs instead.
    const hasLatitudeInput = input.latitude != null;
    const hasLongitudeInput = input.longitude != null;
    const hasCompleteCoordinateInput = hasLatitudeInput && hasLongitudeInput;

    const destinationEdit: DestinationEdit = { rawReferenceText: rawReference };
    if (hasCompleteCoordinateInput) {
      destinationEdit.coordinates = {
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        source: this.resolveLegacyCoordinateSource(input.locationSource, input.locationProvider),
        provider: input.locationProvider ?? null,
        evidenceId: input.locationPlaceId ?? null,
        confidence: input.locationConfidence ?? null,
      };
    }

    let destinationResult: ReturnType<typeof applyDestinationEdit>;
    try {
      destinationResult = applyDestinationEdit(previousSnapshot, destinationEdit);
    } catch (error) {
      if (error instanceof DestinationStateError) {
        throw new BadRequestException('Las coordenadas de entrega deben incluir latitud y longitud juntas.');
      }
      throw error;
    }
    const { snapshot, revisionBumped, classification } = destinationResult;

    // Single source of truth for "may this coordinate pair be used for pricing/coverage right
    // now" — TRUSTED or PROVISIONAL, but always bound to the CURRENT spatial revision. A pair left
    // STALE by a spatial edit (RULE 2) never reaches `deliveryPricingService.estimate()`.
    const coordinatesUsable = isCoordinateProvisionallyUsable(snapshot);
    const latitude = coordinatesUsable ? snapshot.latitude : null;
    const longitude = coordinatesUsable ? snapshot.longitude : null;

    // Provenance/confidence for the pricing call: prefer whatever THIS request explicitly supplied
    // (a genuinely fresh coordinate submission), but fall back to the DESTINATION SNAPSHOT's own
    // recorded provenance/trust when this turn preserved (carried forward) an EXISTING pair rather
    // than resupplying one — e.g. a reference-only PATCH that never included location fields at
    // all. Without this fallback, a preserved-but-real 42km-trusted pair would be re-quoted with
    // `location.provider = null`, which can legitimately drop the pricing engine's derived
    // confidence to LOW (see `DeliveryExternalDataService.resolveOverallConfidence`) purely because
    // this UNRELATED edit's DTO happened not to repeat location metadata — silently blocking a
    // perfectly valid, already-proven quote. The coordinate's own trust lives on the snapshot; use
    // it instead of assuming "no location fields this turn" means "low confidence".
    const pricingLocationProvider = input.locationProvider ?? input.locationSource ?? snapshot.coordinateSource ?? null;
    const pricingLocationConfidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      input.locationConfidence
      ?? (snapshot.coordinateTrust === 'TRUSTED' ? 'HIGH' : snapshot.coordinateTrust === 'PROVISIONAL' ? 'MEDIUM' : 'LOW');

    const pricing = await this.deliveryPricingService.estimate({
      addressText: snapshot.referenceText,
      reference: snapshot.referenceText,
      latitude,
      longitude,
      location:
        latitude != null && longitude != null
          ? {
              provider: pricingLocationProvider,
              placeId: input.locationPlaceId ?? null,
              formattedAddress: input.locationFormattedAddress ?? snapshot.referenceText,
              latitude,
              longitude,
              confidence: pricingLocationConfidence,
            }
          : null,
    });

    // SOFIA Round 5 / A11 CLOSURE (RULE 8 — A8 CRITICAL finding, generalized beyond the single-call
    // case Round 4 covered): if this edit could NOT be proven non-spatial (`classification ===
    // 'AMBIGUOUS'` — e.g. the reference has no recognizable street/number baseline for
    // `classifyRawReferenceChange` to anchor on, so it fails closed rather than assert NON_SPATIAL)
    // AND that unprovable-ness just staled a PREVIOUSLY TRUSTED/PROVISIONAL coordinate pair (RULE
    // 2), the resulting coordinate-less quote must never be allowed to fall back to a bare textual
    // LOCAL_FREE zone-alias match. We do not know whether this is genuinely a NEW destination (a
    // bare zone-alias match is the already-approved happy path for a genuinely new order — see the
    // positive control in `app.critical.spec.ts`) or the SAME destination already proven far away,
    // merely re-described in a way the bounded heuristic could not confidently parse. FAIL CLOSED
    // (CLAUDE.md section 5): treat it as unresolved, never as newly free. A PROVEN spatial change
    // (`classification === 'SPATIAL'`) is NOT affected — that is a positively different address,
    // for which the normal zone-alias happy path still applies exactly as before.
    const localFreeBlockedByAmbiguousStaleness =
      classification === 'AMBIGUOUS' && snapshot.coordinateTrust === 'STALE' && pricing.pricingStatus === 'LOCAL_FREE';
    const effectivePricingStatus = localFreeBlockedByAmbiguousStaleness ? 'NEEDS_ADDRESS_CORRECTION' : pricing.pricingStatus;
    const effectiveRequiresManualQuote = localFreeBlockedByAmbiguousStaleness ? true : pricing.requiresManualQuote;
    const effectiveFinalFee = localFreeBlockedByAmbiguousStaleness ? null : pricing.finalFee;
    const effectiveSuggestedFee = localFreeBlockedByAmbiguousStaleness ? null : pricing.suggestedFee;

    const deliveryFee = new Prisma.Decimal(effectiveFinalFee ?? 0);
    const deliveryZoneLabel = pricing.zoneLabel;
    const deliveryFeeSuggested = effectiveSuggestedFee != null ? new Prisma.Decimal(effectiveSuggestedFee) : null;
    const deliveryEstimatedMinutes = pricing.estimatedMinutes != null ? new Prisma.Decimal(pricing.estimatedMinutes) : null;
    const deliveryDistanceKm =
      pricing.distanceKm != null
        ? new Prisma.Decimal(pricing.distanceKm)
        : !revisionBumped && input.existing?.deliveryDistanceKm != null
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

    // Persistence tier 1 (A9): re-derives the columns this order row actually stores, with the
    // SAFETY invariant already built in — a coordinate pair that is not `isCoordinateProvisionallyUsable`
    // (STALE, bound to a past revision) is NEVER written back as if current; it is written as NULL,
    // exactly like "no coordinates known", so a future reload (RULE 7) can never misread it as
    // valid evidence for the new revision.
    const persistedColumns: OrderTicketDeliveryColumns = toOrderTicketDeliveryColumns(snapshot, new Date());

    return {
      deliveryCustomerId: deliveryCustomer.id,
      // SOFIA Round 5 / A12 CLOSURE (concurrency finding): the RAW reference text this snapshot was
      // actually computed against (`applyDestinationEdit`'s `previous`/`edit.rawReferenceText`),
      // exposed so callers (`update()`) can write it back ATOMICALLY together with the derived
      // fields (`deliveryLatitude`/`deliveryPricingStatus`/etc.) that were computed FROM it — never
      // independently from the caller's raw, possibly-`undefined` DTO field. See `update()`'s
      // `data.deliveryReference` for why this matters: under two truly concurrent `update()` calls
      // to the SAME order (one touching only coordinates, one touching only the reference text),
      // writing `deliveryReference` straight from `dto.deliveryReference` (which Prisma treats as
      // "leave column untouched" when `undefined`) while writing the DERIVED columns from THIS
      // transaction's own (possibly now-stale) `deliverySnapshot` could let one transaction's
      // coordinates land paired with the OTHER transaction's newer reference text — a real,
      // reproduced hybrid/mixed destination state (found via a real concurrent-Postgres test,
      // `round5-a12-cross-cutting-verification.spec.ts` case 26b).
      deliveryReference: rawReference,
      deliveryAddressNormalized: persistedColumns.deliveryAddressNormalized ?? rawReference,
      deliveryLatitude: persistedColumns.deliveryLatitude != null ? new Prisma.Decimal(persistedColumns.deliveryLatitude as number) : null,
      deliveryLongitude: persistedColumns.deliveryLongitude != null ? new Prisma.Decimal(persistedColumns.deliveryLongitude as number) : null,
      deliveryDistanceKm,
      deliveryZoneLabel,
      deliveryFee,
      deliveryFeeSuggested,
      deliveryFeeEdited: pricing.manualEdited,
      deliveryFeeEditReason: pricing.manualEditReason,
      deliveryPricingStatus: effectivePricingStatus,
      deliveryPricingConfidence: pricing.confidence,
      deliveryPricingBreakdown: pricing.breakdown as Prisma.InputJsonValue,
      deliveryCalculationVersion: pricing.calculationVersion,
      deliveryRequiresManualQuote: effectiveRequiresManualQuote,
      deliveryRouteProvider: pricing.providerUsage.routingProvider ?? input.existing?.deliveryRouteProvider ?? null,
      deliveryWeatherProvider: pricing.providerUsage.weatherProvider ?? input.existing?.deliveryWeatherProvider ?? null,
      deliveryGeocodingProvider: pricing.providerUsage.geocodingProvider ?? persistedColumns.deliveryGeocodingProvider ?? null,
      deliveryEstimatedMinutes,
      deliveryPricingAuditId: pricing.auditId ?? null,
      deliveryLocationSource: persistedColumns.deliveryLocationSource,
      deliveryLocationReceivedAt: persistedColumns.deliveryLocationReceivedAt,
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

    await this.auditService.log(
      {
        userId: actorId,
        action: 'INVENTORY_RETURN_FOR_ORDER_REOPEN',
        module: 'inventory',
        entity: 'sale',
        entityId: saleId,
        before: { stockImpact: 'consumed' },
        after: {
          stockImpact: 'restored',
          itemCount: items.length,
          totalProductQuantity: items.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0)),
        },
        metadata: { transactional: true, source: 'order_reopen' },
      },
      tx,
    );
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
      const where: Prisma.DeliveryCustomerWhereInput = {
        fullNameNormalized: { contains: normalizedName },
      };
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
      const updates: Prisma.DeliveryCustomerUpdateInput = {};
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
