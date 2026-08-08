import { Injectable } from '@nestjs/common';
import {
  OrderCheckoutSource,
  OrderCheckoutStatus,
  PaymentIntentProvider,
  PaymentIntentStatus,
  PaymentLinkStatus,
  Prisma,
  SofiaOrderDraftStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { checkoutConflict, checkoutNotFound } from '../order-checkout.errors';
import type {
  CheckoutCustomerSnapshot,
  CheckoutItemSnapshot,
  CreateSofiaCheckoutCommand,
} from '../order-checkout.types';
import { assertPaymentTransition } from '../payment-lifecycle';

type TransitionInput = {
  paymentIntentId: string;
  expectedVersion: number;
  toStatus: PaymentIntentStatus;
  reasonCode: string;
  idempotencyKey: string;
  actorId?: string | null;
  webhookEventId?: string | null;
  metadata?: Prisma.InputJsonValue;
  providerPaymentId?: string | null;
  providerReference?: string | null;
  providerAccountHash?: string | null;
};

@Injectable()
export class PrismaOrderCheckoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createFromSofiaDraft(input: CreateSofiaCheckoutCommand) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.orderCheckout.findUnique({
        where: {
          source_idempotencyKey: {
            source: OrderCheckoutSource.SOFIA,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.sofiaDraftId !== input.draftId ||
          existing.sofiaDraftVersion !== input.expectedDraftVersion ||
          existing.sofiaDraftHash !== input.expectedDraftHash ||
          existing.confirmationHash !== input.confirmationHash
        ) {
          checkoutConflict('CHECKOUT_IDEMPOTENCY_CONFLICT');
        }
        return existing;
      }

      const draft = await tx.sofiaOrderDraft.findUnique({ where: { id: input.draftId } });
      const confirmable =
        draft?.status === SofiaOrderDraftStatus.CONFIRMED &&
        draft.version === input.expectedDraftVersion &&
        draft.draftHash === input.expectedDraftHash &&
        draft.confirmationHash === input.confirmationHash &&
        Boolean(draft.confirmedAt) &&
        Boolean(draft.expiresAt && draft.expiresAt.getTime() > Date.now()) &&
        Boolean(draft.fulfillment) &&
        draft.paymentPreference !== 'UNKNOWN';
      if (!draft || !confirmable) checkoutConflict('SOFIA_DRAFT_NOT_CONFIRMABLE');

      const items = this.items(draft.itemsSnapshot);
      if (!items.length) checkoutConflict('SOFIA_DRAFT_BINDING_INVALID');
      const customer = this.customerSnapshot({
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        deliveryAddress: draft.deliveryAddress,
        deliveryNeighborhood: draft.deliveryNeighborhood,
        deliveryNotes: draft.deliveryNotes,
        deliveryQuoteAuditId: draft.deliveryQuoteAuditId,
        deliveryQuoteVersion: draft.deliveryQuoteVersion,
      });

      try {
        return await tx.orderCheckout.create({
          data: {
            source: OrderCheckoutSource.SOFIA,
            sourceReference: draft.id,
            idempotencyKey: input.idempotencyKey,
            sofiaDraftId: draft.id,
            sofiaDraftVersion: draft.version,
            sofiaDraftHash: draft.draftHash,
            confirmationHash: draft.confirmationHash,
            customerId: draft.customerId,
            customerSnapshot: customer as unknown as Prisma.InputJsonValue,
            itemsSnapshot: items as unknown as Prisma.InputJsonValue,
            subtotal: draft.subtotal,
            deliveryFee: draft.deliveryFee,
            total: draft.total,
            currency: draft.currency,
            fulfillment: draft.fulfillment!,
            paymentPreference: draft.paymentPreference,
            status: OrderCheckoutStatus.CONFIRMED,
            expiresAt: draft.expiresAt,
          },
        });
      } catch (error) {
        if (this.uniqueConflict(error)) checkoutConflict('CHECKOUT_IDEMPOTENCY_CONFLICT');
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  findCheckout(id: string) {
    return this.prisma.orderCheckout.findUnique({
      where: { id },
      include: {
        paymentIntents: { orderBy: { attemptNumber: 'desc' }, include: { links: true } },
        orderTicket: true,
      },
    });
  }

  findSofiaCheckoutByIdempotency(idempotencyKey: string) {
    return this.prisma.orderCheckout.findUnique({
      where: { source_idempotencyKey: { source: OrderCheckoutSource.SOFIA, idempotencyKey } },
    });
  }

  async requiredCheckout(id: string) {
    const checkout = await this.findCheckout(id);
    if (!checkout) checkoutNotFound();
    return checkout;
  }

  async createPaymentIntent(input: {
    checkoutId: string;
    idempotencyKey: string;
    provider: PaymentIntentProvider;
    expiresAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${input.checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({ where: { id: input.checkoutId } });
      if (!checkout) checkoutNotFound();
      const existing = await tx.paymentIntent.findUnique({
        where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) {
        if (existing.checkoutId !== checkout.id || !existing.amount.equals(checkout.total) || existing.currency !== checkout.currency) {
          checkoutConflict('PAYMENT_INTENT_CONFLICT');
        }
        return existing;
      }
      const attemptNumber = await tx.paymentIntent.count({ where: { checkoutId: checkout.id } }).then((count) => count + 1);
      const intent = await tx.paymentIntent.create({
        data: {
          checkoutId: checkout.id,
          attemptNumber,
          idempotencyKey: input.idempotencyKey,
          provider: input.provider,
          amount: checkout.total,
          currency: checkout.currency,
          status: PaymentIntentStatus.CREATED,
          expiresAt: input.expiresAt,
          transitions: {
            create: {
              toStatus: PaymentIntentStatus.CREATED,
              reasonCode: 'PAYMENT_INTENT_CREATED',
              idempotencyKey: `${input.idempotencyKey}:created`,
              sanitizedMetadata: { provider: input.provider },
            },
          },
        },
      });
      await tx.orderCheckout.updateMany({
        where: { id: checkout.id, version: checkout.version },
        data: { status: OrderCheckoutStatus.PAYMENT_PENDING, version: { increment: 1 } },
      });
      return intent;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  createPaymentLink(input: { paymentIntentId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "payment_intents" WHERE id = ${input.paymentIntentId} FOR UPDATE`;
      const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: input.paymentIntentId } });
      const existing = await tx.paymentLink.findFirst({
        where: {
          paymentIntentId: intent.id,
          status: { in: [PaymentLinkStatus.ACTIVE, PaymentLinkStatus.OPENED] },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { link: existing, created: false } as const;
      assertPaymentTransition(intent.status, PaymentIntentStatus.LINK_READY);
      const link = await tx.paymentLink.create({
        data: {
          paymentIntentId: input.paymentIntentId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          status: PaymentLinkStatus.ACTIVE,
        },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.LINK_READY,
          version: { increment: 1 },
          transitions: {
            create: {
              fromStatus: intent.status,
              toStatus: PaymentIntentStatus.LINK_READY,
              reasonCode: 'PAYMENT_LINK_READY',
              idempotencyKey: `${intent.id}:link-ready`,
              sanitizedMetadata: { tokenPersisted: false },
            },
          },
        },
      });
      return { link, created: true } as const;
    });
  }

  findActivePaymentLink(paymentIntentId: string) {
    return this.prisma.paymentLink.findFirst({
      where: {
        paymentIntentId,
        status: { in: [PaymentLinkStatus.ACTIVE, PaymentLinkStatus.OPENED] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findWebhook(provider: string, eventId: string) {
    return this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });
  }

  findPaymentLink(tokenHash: string) {
    return this.prisma.paymentLink.findUnique({
      where: { tokenHash },
      include: { paymentIntent: { include: { checkout: true } } },
    });
  }

  findPaymentIntent(id: string) {
    return this.prisma.paymentIntent.findUniqueOrThrow({ where: { id } });
  }

  findPaymentIntentByIdempotency(provider: PaymentIntentProvider, idempotencyKey: string) {
    return this.prisma.paymentIntent.findUnique({
      where: { provider_idempotencyKey: { provider, idempotencyKey } },
    });
  }

  markPaymentLinkOpened(id: string) {
    return this.prisma.paymentLink.update({
      where: { id },
      data: { openedAt: new Date(), status: PaymentLinkStatus.OPENED },
    });
  }

  async transitionPayment(input: TransitionInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "payment_intents" WHERE id = ${input.paymentIntentId} FOR UPDATE`;
      const intent = await tx.paymentIntent.findUnique({ where: { id: input.paymentIntentId } });
      if (!intent) checkoutNotFound();
      const existing = await tx.paymentTransition.findUnique({
        where: {
          paymentIntentId_idempotencyKey: {
            paymentIntentId: intent.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return intent;
      if (intent.version !== input.expectedVersion) checkoutConflict('PAYMENT_INTENT_CONFLICT');
      assertPaymentTransition(intent.status, input.toStatus);

      const updated = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: input.toStatus,
          version: { increment: 1 },
          completedAt: this.terminal(input.toStatus) ? new Date() : null,
          failureCode:
            (input.toStatus === PaymentIntentStatus.FAILED || input.toStatus === PaymentIntentStatus.UNKNOWN_RESULT || input.toStatus === PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED)
              ? input.reasonCode
              : null,
          providerPaymentId: input.providerPaymentId ?? intent.providerPaymentId,
          providerReference: input.providerReference ?? intent.providerReference,
          providerAccountHash: input.providerAccountHash ?? intent.providerAccountHash,
          transitions: {
            create: {
              fromStatus: intent.status,
              toStatus: input.toStatus,
              reasonCode: input.reasonCode,
              actorId: input.actorId ?? null,
              webhookEventId: input.webhookEventId ?? null,
              idempotencyKey: input.idempotencyKey,
              sanitizedMetadata: input.metadata,
            },
          },
        },
      });
      return updated;
    });
  }

  async markKitchenEligible(checkoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({ where: { id: checkoutId } });
      if (!checkout) checkoutNotFound();
      if (checkout.status === OrderCheckoutStatus.KITCHEN_ELIGIBLE || checkout.status === OrderCheckoutStatus.ORDER_CREATED) return checkout;
      const updated = await tx.orderCheckout.updateMany({
        where: { id: checkout.id, version: checkout.version, status: { in: [OrderCheckoutStatus.CONFIRMED, OrderCheckoutStatus.PAYMENT_PENDING, OrderCheckoutStatus.PAYMENT_VERIFIED] } },
        data: { status: OrderCheckoutStatus.KITCHEN_ELIGIBLE, kitchenEligibleAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) checkoutConflict('KITCHEN_NOT_ELIGIBLE');
      return tx.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    });
  }

  async markCheckoutPaymentVerified(checkoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({ where: { id: checkoutId } });
      if (!checkout) checkoutNotFound();
      if (
        checkout.status === OrderCheckoutStatus.PAYMENT_VERIFIED ||
        checkout.status === OrderCheckoutStatus.KITCHEN_ELIGIBLE ||
        checkout.status === OrderCheckoutStatus.ORDER_CREATED
      ) return checkout;
      const updated = await tx.orderCheckout.updateMany({
        where: { id: checkout.id, version: checkout.version, status: OrderCheckoutStatus.PAYMENT_PENDING },
        data: { status: OrderCheckoutStatus.PAYMENT_VERIFIED, version: { increment: 1 } },
      });
      if (updated.count !== 1) checkoutConflict('PAYMENT_INTENT_CONFLICT');
      return tx.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    });
  }

  async successfulPaymentCount(checkoutId: string) {
    return this.prisma.paymentIntent.count({ where: { checkoutId, status: PaymentIntentStatus.SUCCEEDED } });
  }

  async markFinancialReview(checkoutId: string, reasonCode: string) {
    await this.prisma.orderCheckout.update({
      where: { id: checkoutId },
      data: { status: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED, version: { increment: 1 } },
    });
    return { reasonCode };
  }

  async createWebhookEvidence(input: {
    paymentIntentId?: string | null;
    provider: string;
    eventId: string | null;
    providerPaymentId: string | null;
    providerReference: string | null;
    eventType: string;
    status: string;
    amount: number | null;
    currency: string | null;
    signatureValid: boolean;
    payloadHash: string;
    providerAccountHash: string | null;
    processedStatus: string;
    rawPayload: Prisma.InputJsonValue;
  }) {
    try {
      return await this.prisma.paymentWebhookEvent.create({
        data: { ...input, processedAt: new Date() },
      });
    } catch (error) {
      if (input.eventId && this.uniqueConflict(error)) {
        return this.prisma.paymentWebhookEvent.findUnique({
          where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
        });
      }
      throw error;
    }
  }

  async findIntentByProvider(input: { provider: PaymentIntentProvider; providerPaymentId?: string | null; providerReference?: string | null }) {
    if (!input.providerPaymentId && !input.providerReference) return null;
    const matches = await this.prisma.paymentIntent.findMany({
      where: {
        provider: input.provider,
        ...(input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : {}),
        ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      },
      include: { checkout: true },
      take: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  }

  private items(value: Prisma.JsonValue): CheckoutItemSnapshot[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      if (typeof item.productId !== 'string' || typeof item.name !== 'string') return [];
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return [];
      const modifiers = Array.isArray(item.modifiers)
        ? item.modifiers.flatMap((modifier) => {
            if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) return [];
            const entry = modifier as Record<string, unknown>;
            if (!['REMOVE', 'ADD', 'NOTE'].includes(String(entry.kind))) return [];
            return [{
              kind: String(entry.kind) as 'REMOVE' | 'ADD' | 'NOTE',
              ingredient: typeof entry.name === 'string' ? entry.name.slice(0, 120) : null,
              quantity: typeof entry.quantity === 'number' ? entry.quantity : null,
            }];
          })
        : [];
      return [{
        productId: item.productId,
        code: typeof item.code === 'string' ? item.code : item.productId,
        name: item.name,
        quantity,
        unitPrice,
        totalPrice: Number.isFinite(Number(item.totalPrice)) ? Number(item.totalPrice) : quantity * unitPrice,
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 240) : null,
        modifiers,
      }];
    });
  }

  private customerSnapshot(input: {
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
    deliveryNeighborhood: string | null;
    deliveryNotes: string | null;
    deliveryQuoteAuditId: string | null;
    deliveryQuoteVersion: number | null;
  }): CheckoutCustomerSnapshot {
    const digits = input.customerPhone?.replace(/\D/g, '') ?? '';
    return {
      name: input.customerName?.slice(0, 160) ?? null,
      phoneMasked: digits ? `***${digits.slice(-4)}` : null,
      deliveryAddress: input.deliveryAddress?.slice(0, 300) ?? null,
      deliveryNeighborhood: input.deliveryNeighborhood?.slice(0, 160) ?? null,
      deliveryNotes: input.deliveryNotes?.slice(0, 300) ?? null,
      deliveryQuoteAuditId: input.deliveryQuoteAuditId,
      deliveryQuoteVersion: input.deliveryQuoteVersion,
    };
  }

  private terminal(status: PaymentIntentStatus) {
    return status === PaymentIntentStatus.SUCCEEDED ||
      status === PaymentIntentStatus.FAILED ||
      status === PaymentIntentStatus.EXPIRED ||
      status === PaymentIntentStatus.CANCELLED ||
      status === PaymentIntentStatus.UNKNOWN_RESULT ||
      status === PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
  }

  private uniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
