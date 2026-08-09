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
import { assertCheckoutPaymentCombination } from '../checkout-policy.service';
import { checkoutConflict, checkoutNotFound } from '../order-checkout.errors';
import type {
  CanonicalWebhookResult,
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
  webhookClaim?: { webhookId: string; leaseOwnerHash: string };
};

export type WebhookEvidenceInput = {
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
};

type WebhookLifecycleRow = {
  id: string;
  paymentIntentId: string | null;
  providerAccountHash: string | null;
  payloadHash: string | null;
  processedStatus: string;
  processedAt: Date | null;
  processingAttempts: number;
  processingLeaseOwnerHash: string | null;
  processingLeaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
  resultCode: string | null;
  deterministicResult: Prisma.JsonValue | null;
  lastErrorCode: string | null;
  retryable: boolean;
  transitionApplied: boolean;
};

export type WebhookClaimResult =
  | { state: 'CLAIMED'; webhookId: string; paymentIntentId: string | null; transitionApplied: boolean; attempt: number }
  | { state: 'REPLAY'; webhookId: string; result: CanonicalWebhookResult }
  | { state: 'ACTIVE'; webhookId: string; paymentIntentId: string | null }
  | { state: 'BLOCKED'; webhookId: string; reasonCode: 'LEGACY_AMBIGUOUS' | 'NOT_RETRYABLE' | 'ATTEMPTS_EXHAUSTED' }
  | { state: 'IDENTITY_CONFLICT'; webhookId: string };

@Injectable()
export class PrismaOrderCheckoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRuntimeSafetySettings() {
    return this.prisma.setting.findMany({
      where: { key: { in: ['SOFIA_GLOBAL_PAUSED', 'SOFIA_KILL_SWITCH'] } },
      select: { key: true, value: true },
    });
  }

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
        assertCheckoutPaymentCombination(existing.fulfillment, existing.paymentPreference);
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
        Boolean(draft.fulfillment);
      if (!draft || !confirmable) checkoutConflict('SOFIA_DRAFT_NOT_CONFIRMABLE');
      assertCheckoutPaymentCombination(draft.fulfillment!, draft.paymentPreference);

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

      return tx.orderCheckout.create({
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

  findPaymentLinkById(id: string) {
    return this.prisma.paymentLink.findUnique({
      where: { id },
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
      if (input.webhookClaim) {
        const owned = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM payment_webhook_events
          WHERE id = ${input.webhookClaim.webhookId}
            AND processed_status = 'PROCESSING'
            AND processing_lease_owner_hash = ${input.webhookClaim.leaseOwnerHash}
            AND processing_lease_expires_at > CURRENT_TIMESTAMP
          FOR UPDATE
        `;
        if (owned.length !== 1) checkoutConflict('PAYMENT_WEBHOOK_CLAIM_LOST');
      }
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
    const updated = await this.prisma.orderCheckout.updateMany({
      where: { id: checkoutId, status: { not: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED } },
      data: { status: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const checkout = await this.prisma.orderCheckout.findUnique({ where: { id: checkoutId }, select: { id: true } });
      if (!checkout) checkoutNotFound();
    }
    return { reasonCode };
  }

  async createWebhookEvidence(input: WebhookEvidenceInput) {
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

  async claimWebhookEvidence(input: WebhookEvidenceInput & {
    leaseOwnerHash: string;
    leaseExpiresAt: Date;
    maxAttempts: number;
  }): Promise<WebhookClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      const identity = `${input.provider}:${input.eventId ?? input.payloadHash}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;

      const identityFilter = input.eventId
        ? Prisma.sql`provider = ${input.provider} AND event_id = ${input.eventId}`
        : Prisma.sql`provider = ${input.provider} AND event_id IS NULL AND payload_hash = ${input.payloadHash}`;
      const rows = await tx.$queryRaw<WebhookLifecycleRow[]>(Prisma.sql`
        SELECT
          event.id,
          event.payment_intent_id AS "paymentIntentId",
          event.provider_account_hash AS "providerAccountHash",
          event.payload_hash AS "payloadHash",
          event.processed_status AS "processedStatus",
          event.processed_at AS "processedAt",
          event.processing_attempts AS "processingAttempts",
          event.processing_lease_owner_hash AS "processingLeaseOwnerHash",
          event.processing_lease_expires_at AS "processingLeaseExpiresAt",
          event.next_retry_at AS "nextRetryAt",
          event.result_code AS "resultCode",
          event.deterministic_result AS "deterministicResult",
          event.last_error_code AS "lastErrorCode",
          event.retryable,
          EXISTS (
            SELECT 1 FROM payment_transitions transition
            WHERE transition.webhook_event_id = event.id
          ) AS "transitionApplied"
        FROM payment_webhook_events event
        WHERE ${identityFilter}
        ORDER BY event.received_at ASC
        LIMIT 1
        FOR UPDATE
      `);
      const existing = rows[0];
      if (!existing) {
        const {
          leaseOwnerHash: _leaseOwnerHash,
          leaseExpiresAt: _leaseExpiresAt,
          maxAttempts: _maxAttempts,
          ...evidence
        } = input;
        const created = await tx.paymentWebhookEvent.create({
          data: {
            ...evidence,
            processedStatus: 'PROCESSING',
            processedAt: null,
          },
        });
        await tx.$executeRaw`
          UPDATE payment_webhook_events
          SET processing_attempts = 1,
              processing_lease_owner_hash = ${input.leaseOwnerHash},
              processing_lease_expires_at = ${input.leaseExpiresAt},
              retryable = false,
              next_retry_at = NULL,
              last_error_code = NULL
          WHERE id = ${created.id}
        `;
        return {
          state: 'CLAIMED',
          webhookId: created.id,
          paymentIntentId: created.paymentIntentId,
          transitionApplied: false,
          attempt: 1,
        };
      }

      if (existing.payloadHash !== input.payloadHash) {
        return { state: 'IDENTITY_CONFLICT', webhookId: existing.id };
      }
      if (
        existing.providerAccountHash !== input.providerAccountHash
        || (existing.paymentIntentId && input.paymentIntentId && existing.paymentIntentId !== input.paymentIntentId)
      ) {
        return { state: 'IDENTITY_CONFLICT', webhookId: existing.id };
      }
      const deterministic = this.canonicalWebhookResult(existing.deterministicResult);
      if (deterministic) {
        return { state: 'REPLAY', webhookId: existing.id, result: deterministic };
      }
      if (existing.processedAt) {
        if (existing.transitionApplied || existing.processedStatus === 'REFERENCE_UNKNOWN') {
          return {
            state: 'REPLAY',
            webhookId: existing.id,
            result: {
              processedStatus: existing.processedStatus === 'REFERENCE_UNKNOWN' ? 'REFERENCE_UNKNOWN' : 'DUPLICATE_REPLAY',
              paymentIntentId: existing.paymentIntentId,
              paymentStatus: null,
            },
          };
        }
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'LEGACY_AMBIGUOUS' };
      }
      if (existing.processingAttempts === 0) {
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'LEGACY_AMBIGUOUS' };
      }
      const now = new Date();
      if (existing.processingLeaseExpiresAt && existing.processingLeaseExpiresAt > now) {
        return { state: 'ACTIVE', webhookId: existing.id, paymentIntentId: existing.paymentIntentId };
      }
      if (existing.nextRetryAt && existing.nextRetryAt > now) {
        return { state: 'ACTIVE', webhookId: existing.id, paymentIntentId: existing.paymentIntentId };
      }
      if (existing.processedStatus === 'FAILED' && !existing.retryable) {
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'NOT_RETRYABLE' };
      }
      if (existing.processingAttempts >= input.maxAttempts) {
        await tx.$executeRaw`
          UPDATE payment_webhook_events
          SET processed_status = 'FAILED',
              processed_at = CURRENT_TIMESTAMP,
              processing_lease_owner_hash = NULL,
              processing_lease_expires_at = NULL,
              retryable = false,
              next_retry_at = NULL,
              result_code = 'PROCESSING_ATTEMPTS_EXHAUSTED',
              last_error_code = COALESCE(last_error_code, 'PROCESSING_ATTEMPTS_EXHAUSTED')
          WHERE id = ${existing.id}
        `;
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'ATTEMPTS_EXHAUSTED' };
      }

      const attempt = existing.processingAttempts + 1;
      await tx.$executeRaw`
        UPDATE payment_webhook_events
        SET processed_status = 'PROCESSING',
            processed_at = NULL,
            payment_intent_id = COALESCE(payment_intent_id, ${input.paymentIntentId ?? null}),
            processing_attempts = ${attempt},
            processing_lease_owner_hash = ${input.leaseOwnerHash},
            processing_lease_expires_at = ${input.leaseExpiresAt},
            retryable = false,
            next_retry_at = NULL,
            last_error_code = NULL
        WHERE id = ${existing.id}
      `;
      return {
        state: 'CLAIMED',
        webhookId: existing.id,
        paymentIntentId: existing.paymentIntentId,
        transitionApplied: existing.transitionApplied,
        attempt,
      };
    });
  }

  async completeWebhookClaim(input: {
    webhookId: string;
    leaseOwnerHash: string;
    result: CanonicalWebhookResult;
  }) {
    const deterministicResult = JSON.stringify(input.result);
    const updated = await this.prisma.$executeRaw`
      UPDATE payment_webhook_events
      SET processed_status = 'PROCESSED',
          processed_at = CURRENT_TIMESTAMP,
          result_code = ${input.result.processedStatus},
          deterministic_result = ${deterministicResult}::jsonb,
          processing_lease_owner_hash = NULL,
          processing_lease_expires_at = NULL,
          retryable = false,
          next_retry_at = NULL,
          last_error_code = NULL
      WHERE id = ${input.webhookId}
        AND processed_status = 'PROCESSING'
        AND processing_lease_owner_hash = ${input.leaseOwnerHash}
        AND processing_lease_expires_at > CURRENT_TIMESTAMP
    `;
    if (updated !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async assertWebhookClaimOwned(webhookId: string, leaseOwnerHash: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM payment_webhook_events
      WHERE id = ${webhookId}
        AND processed_status = 'PROCESSING'
        AND processing_lease_owner_hash = ${leaseOwnerHash}
        AND processing_lease_expires_at > CURRENT_TIMESTAMP
    `;
    if (rows.length !== 1) checkoutConflict('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async failWebhookClaim(input: {
    webhookId: string;
    leaseOwnerHash: string;
    errorCode: string;
    maxAttempts: number;
    retryable: boolean;
  }) {
    const updated = await this.prisma.$executeRaw`
      UPDATE payment_webhook_events
      SET processed_status = 'FAILED',
          processed_at = CASE
            WHEN processing_attempts >= ${input.maxAttempts} OR NOT ${input.retryable}
              THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          processing_lease_owner_hash = NULL,
          processing_lease_expires_at = NULL,
          retryable = ${input.retryable} AND processing_attempts < ${input.maxAttempts},
          next_retry_at = CASE
            WHEN ${input.retryable} AND processing_attempts < ${input.maxAttempts}
              THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          result_code = CASE
            WHEN processing_attempts >= ${input.maxAttempts} THEN 'PROCESSING_ATTEMPTS_EXHAUSTED'
            WHEN NOT ${input.retryable} THEN ${input.errorCode}
            ELSE result_code
          END,
          last_error_code = ${input.errorCode}
      WHERE id = ${input.webhookId}
        AND processed_status = 'PROCESSING'
        AND processing_lease_owner_hash = ${input.leaseOwnerHash}
        AND processing_lease_expires_at > CURRENT_TIMESTAMP
    `;
    if (updated !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
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

  private canonicalWebhookResult(value: Prisma.JsonValue | null): CanonicalWebhookResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = value as Record<string, unknown>;
    const processedStatuses: CanonicalWebhookResult['processedStatus'][] = [
      'PROCESSED',
      'DUPLICATE_REPLAY',
      'SIGNATURE_INVALID',
      'REFERENCE_UNKNOWN',
      'AMOUNT_MISMATCH',
      'CURRENCY_MISMATCH',
      'ACCOUNT_MISMATCH',
      'FINANCIAL_REVIEW_REQUIRED',
    ];
    if (!processedStatuses.includes(result.processedStatus as CanonicalWebhookResult['processedStatus'])) return null;
    const paymentStatus = Object.values(PaymentIntentStatus).includes(result.paymentStatus as PaymentIntentStatus)
      ? result.paymentStatus as PaymentIntentStatus
      : null;
    return {
      processedStatus: result.processedStatus as CanonicalWebhookResult['processedStatus'],
      paymentIntentId: typeof result.paymentIntentId === 'string' ? result.paymentIntentId : null,
      paymentStatus,
    };
  }

  private uniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
