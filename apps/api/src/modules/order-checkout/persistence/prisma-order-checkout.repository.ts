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
  PaymentIntentRelinkPolicy,
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

export type ClaimedWebhookEvidence = {
  id: string;
  provider: string;
  eventId: string | null;
  providerPaymentId: string | null;
  providerReference: string | null;
  eventType: string;
  status: string;
  amount: Prisma.Decimal | null;
  currency: string | null;
  signatureValid: boolean;
  payloadHash: string | null;
  providerAccountHash: string | null;
  processedStatus: string;
  transitionApplied: boolean;
  paymentIntent: Prisma.PaymentIntentGetPayload<{ include: { checkout: true } }> | null;
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

  /**
   * Read-only re-derivation of a CONFIRMED SofiaOrderDraft's authoritative version/hash chain,
   * used by the SOFIA_CREATE_ORDER command handler to build a CreateSofiaCheckoutCommand without
   * ever trusting caller-supplied version/hash values. Never mutates the draft or creates a
   * checkout -- creation is always performed by `createFromSofiaDraft`, which independently
   * re-validates every one of these fields again against the database inside its own transaction.
   */
  async requiredConfirmedSofiaDraftBinding(draftId: string): Promise<{
    id: string;
    version: number;
    draftHash: string;
    confirmationHash: string;
  }> {
    const draft = await this.prisma.sofiaOrderDraft.findUnique({ where: { id: draftId } });
    const confirmable =
      draft?.status === SofiaOrderDraftStatus.CONFIRMED &&
      Boolean(draft.draftHash) &&
      Boolean(draft.confirmationHash) &&
      Boolean(draft.confirmedAt) &&
      Boolean(draft.expiresAt && draft.expiresAt.getTime() > Date.now()) &&
      Boolean(draft.fulfillment);
    if (!draft || !confirmable) checkoutConflict('SOFIA_DRAFT_NOT_CONFIRMABLE');
    return {
      id: draft.id,
      version: draft.version,
      draftHash: draft.draftHash!,
      confirmationHash: draft.confirmationHash!,
    };
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
    relinkPolicy: PaymentIntentRelinkPolicy;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${input.checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({ where: { id: input.checkoutId } });
      if (!checkout) checkoutNotFound();
      // PK5 TOCTOU remediation: re-read all PaymentIntent rows for this checkout fresh, under the
      // FOR UPDATE lock just taken above, and re-run the full relink/active-attempt policy against
      // that freshly-locked state -- never against a pre-transaction snapshot. This must happen
      // before the (provider, idempotencyKey) replay lookup below so that a concurrent attempt with
      // a *different* idempotencyKey for the same checkout is rejected here instead of falling
      // through to create a second, independent PaymentIntent.
      const currentPaymentIntents = await tx.paymentIntent.findMany({
        where: { checkoutId: checkout.id },
        orderBy: { attemptNumber: 'desc' },
      });
      input.relinkPolicy(checkout, currentPaymentIntents);
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

  async beginProviderPayment(input: {
    paymentIntentId: string;
    expectedVersion: number;
    providerReference: string;
    providerAccountHash: string | null;
    idempotencyKey: string;
  }) {
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
      if (existing) {
        if (
          intent.providerReference !== input.providerReference ||
          intent.providerAccountHash !== input.providerAccountHash
        ) {
          checkoutConflict('PAYMENT_INTENT_CONFLICT');
        }
        return { paymentIntent: intent, started: false } as const;
      }

      if (intent.version !== input.expectedVersion) checkoutConflict('PAYMENT_INTENT_CONFLICT');
      if (intent.providerReference && intent.providerReference !== input.providerReference) {
        checkoutConflict('PAYMENT_INTENT_CONFLICT');
      }
      if (intent.providerAccountHash && intent.providerAccountHash !== input.providerAccountHash) {
        checkoutConflict('PAYMENT_INTENT_CONFLICT');
      }
      const referenceCollision = await tx.paymentIntent.findFirst({
        where: {
          provider: intent.provider,
          providerReference: input.providerReference,
          id: { not: intent.id },
        },
        select: { id: true },
      });
      if (referenceCollision) checkoutConflict('PAYMENT_INTENT_CONFLICT');
      assertPaymentTransition(intent.status, PaymentIntentStatus.PENDING);

      const paymentIntent = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.PENDING,
          providerReference: input.providerReference,
          providerAccountHash: input.providerAccountHash,
          version: { increment: 1 },
          transitions: {
            create: {
              fromStatus: intent.status,
              toStatus: PaymentIntentStatus.PENDING,
              reasonCode: 'PROVIDER_PAYMENT_REQUESTED',
              idempotencyKey: input.idempotencyKey,
              sanitizedMetadata: { provider: intent.provider, referenceBoundBeforeRequest: true },
            },
          },
        },
      });
      return { paymentIntent, started: true } as const;
    });
  }

  async bindProviderPaymentResult(input: {
    paymentIntentId: string;
    providerReference: string;
    providerPaymentId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "payment_intents" WHERE id = ${input.paymentIntentId} FOR UPDATE`;
      const intent = await tx.paymentIntent.findUnique({ where: { id: input.paymentIntentId } });
      if (!intent) checkoutNotFound();
      if (
        intent.providerReference !== input.providerReference ||
        (intent.providerPaymentId && intent.providerPaymentId !== input.providerPaymentId)
      ) {
        checkoutConflict('PAYMENT_INTENT_CONFLICT');
      }
      if (intent.providerPaymentId === input.providerPaymentId) return intent;

      const paymentIdCollision = await tx.paymentIntent.findUnique({
        where: {
          provider_providerPaymentId: {
            provider: intent.provider,
            providerPaymentId: input.providerPaymentId,
          },
        },
        select: { id: true },
      });
      if (paymentIdCollision && paymentIdCollision.id !== intent.id) {
        checkoutConflict('PAYMENT_INTENT_CONFLICT');
      }
      return tx.paymentIntent.update({
        where: { id: intent.id },
        data: { providerPaymentId: input.providerPaymentId, version: { increment: 1 } },
      });
    });
  }

  async markProviderPaymentUnknown(input: {
    paymentIntentId: string;
    providerReference: string;
    idempotencyKey: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "payment_intents" WHERE id = ${input.paymentIntentId} FOR UPDATE`;
      const intent = await tx.paymentIntent.findUnique({ where: { id: input.paymentIntentId } });
      if (!intent) checkoutNotFound();
      if (intent.providerReference !== input.providerReference) checkoutConflict('PAYMENT_INTENT_CONFLICT');

      const existing = await tx.paymentTransition.findUnique({
        where: {
          paymentIntentId_idempotencyKey: {
            paymentIntentId: intent.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing || intent.status !== PaymentIntentStatus.PENDING) {
        return { paymentIntent: intent, marked: false } as const;
      }
      assertPaymentTransition(intent.status, PaymentIntentStatus.UNKNOWN_RESULT);
      const paymentIntent = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.UNKNOWN_RESULT,
          completedAt: new Date(),
          failureCode: 'BOLD_CREATE_UNKNOWN_RESULT',
          version: { increment: 1 },
          transitions: {
            create: {
              fromStatus: intent.status,
              toStatus: PaymentIntentStatus.UNKNOWN_RESULT,
              reasonCode: 'BOLD_CREATE_UNKNOWN_RESULT',
              idempotencyKey: input.idempotencyKey,
              sanitizedMetadata: { retryAllowed: false, providerReferencePersisted: true },
            },
          },
        },
      });
      return { paymentIntent, marked: true } as const;
    });
  }

  async transitionPayment(input: TransitionInput) {
    return this.prisma.$transaction(async (tx) => {
      if (input.webhookClaim) {
        // P6 fix (found while building the timezone matrix, same CANONICAL_TEMPORAL_AUTHORITY
        // class as claimWebhookEvidence et al. — see .engineering/sofia-production/remediation/
        // payment-lease-timezone/00-design.md): this ownership check needs `FOR UPDATE` row
        // locking inside the surrounding transaction, so it cannot move to the typed Prisma
        // Client (no typed-client `SELECT ... FOR UPDATE`). The naive `processing_lease_expires_at`
        // timestamp(3) column was compared directly against `CURRENT_TIMESTAMP` (a `timestamptz`),
        // which forces Postgres to implicitly interpret the naive value using the *session's*
        // `TimeZone` GUC to make the types comparable — empirically verified to make an already
        // (legitimately) expired lease appear still active under a non-UTC session (e.g.
        // America/Bogota), which would let `transitionPayment` proceed on a stale/reclaimable
        // claim instead of raising `PAYMENT_WEBHOOK_CLAIM_LOST`. `AT TIME ZONE 'UTC'` explicitly
        // declares the naive value's zone as UTC (matching how the typed client wrote it) before
        // comparing, making the comparison session-timezone-independent while preserving the row
        // lock — the same technique already used for the raw aggregate reads in
        // operational-backlog.service.ts. Never compare this column to `CURRENT_TIMESTAMP` (or
        // any bind parameter) without this cast.
        const owned = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM payment_webhook_events
          WHERE id = ${input.webhookClaim.webhookId}
            AND processed_status IN ('PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED')
            AND processing_lease_owner_hash = ${input.webhookClaim.leaseOwnerHash}
            AND (processing_lease_expires_at AT TIME ZONE 'UTC') > CURRENT_TIMESTAMP
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

  /**
   * PK4 (Recovery / Expiration): read-only candidate scan for PaymentExpirationWorker. Indexed by
   * the pre-existing `[status, expiresAt]` index on payment_intents -- no migration required.
   * Callers must re-fetch and re-validate (via findPaymentIntent + transitionPayment's own
   * version/lock guard) before mutating; this method never mutates.
   */
  async findExpirablePaymentIntentIds(now: Date, limit: number): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.LINK_READY, PaymentIntentStatus.PENDING] },
        expiresAt: { lte: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: boundedLimit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * PK4 (Recovery / Expiration): housekeeping-only status flip for stale PaymentLink rows past
   * their TTL. PaymentLink.status is never consulted by any financial-authority decision (the
   * financial-relevant expiry check is always the read-time `expiresAt` comparison already used by
   * findActivePaymentLink / resolvePaymentLink), so this is a plain unversioned bulk update -- safe
   * under concurrency, no optimistic-lock/idempotency-key machinery required.
   */
  async expireStalePaymentLinks(now: Date, limit: number): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const stale = await this.prisma.paymentLink.findMany({
      where: { status: { in: [PaymentLinkStatus.ACTIVE, PaymentLinkStatus.OPENED] }, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: boundedLimit,
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const result = await this.prisma.paymentLink.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: PaymentLinkStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * PK4 (Recovery / Expiration): read-only candidate scan for checkouts that never converged to a
   * successful payment within their own window. Indexed by the pre-existing `[status, expiresAt]`
   * index on order_checkouts.
   */
  async findExpirableCheckoutIds(now: Date, limit: number): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = await this.prisma.orderCheckout.findMany({
      where: { status: OrderCheckoutStatus.PAYMENT_PENDING, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: boundedLimit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * PK4 (Recovery / Expiration): version-guarded, re-validated-under-lock transition of a
   * PAYMENT_PENDING checkout to EXPIRED once its own deadline has passed. Mirrors the
   * lock-then-conditional-updateMany pattern already used by markKitchenEligible /
   * markCheckoutPaymentVerified. Never fires if the checkout has since moved on (KITCHEN_ELIGIBLE,
   * ORDER_CREATED, FINANCIAL_REVIEW_REQUIRED, ...) -- the `status: PAYMENT_PENDING` filter inside
   * the version-guarded updateMany makes that race safe.
   */
  async expireCheckoutPaymentPending(checkoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_checkouts" WHERE id = ${checkoutId} FOR UPDATE`;
      const checkout = await tx.orderCheckout.findUnique({ where: { id: checkoutId } });
      if (!checkout) checkoutNotFound();
      if (checkout.status !== OrderCheckoutStatus.PAYMENT_PENDING) checkoutConflict('CHECKOUT_NOT_PAYABLE');
      if (!checkout.expiresAt || checkout.expiresAt.getTime() > Date.now()) checkoutConflict('CHECKOUT_NOT_PAYABLE');
      const updated = await tx.orderCheckout.updateMany({
        where: { id: checkout.id, version: checkout.version, status: OrderCheckoutStatus.PAYMENT_PENDING },
        data: { status: OrderCheckoutStatus.EXPIRED, version: { increment: 1 } },
      });
      if (updated.count !== 1) checkoutConflict('CHECKOUT_NOT_PAYABLE');
      return tx.orderCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
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

  /**
   * Resolves a stable, disabled (never loginable) system principal used solely to attribute
   * OrderTicket.createdById when a canonical order is created from a SOFIA-originated command.
   * Mirrors the established `inboundRecoveryActorId` pattern used by WhatsApp production recovery
   * (see prisma-whatsapp-conversation.repository.ts) so referential integrity never depends on an
   * admin/cashier session being active at the moment SOFIA's SecureCommand handler executes.
   */
  async sofiaOrderCreationSystemActor(): Promise<{ sub: string; email: string; fullName: string }> {
    const id = 'sofia-order-creation-system';
    const email = 'sofia-order-creation-system@system.invalid';
    const actor = await this.prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email,
        passwordHash: '!disabled-system-principal!',
        fullName: 'SOFIA Order Creation',
        isActive: false,
      },
      select: { id: true, email: true, fullName: true, isActive: true },
    });
    if (actor.email !== email || actor.isActive) {
      throw new Error('SOFIA_ORDER_CREATION_ACTOR_CONFLICT');
    }
    return { sub: actor.id, email: actor.email, fullName: actor.fullName };
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;

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
        // CANONICAL_TEMPORAL_AUTHORITY: processing_lease_expires_at / next_retry_at are naive
        // TIMESTAMP(3) columns; only the typed Prisma Client's UTC-normalized serialization is
        // session-timezone-independent (see .engineering/sofia-production/remediation/
        // payment-lease-timezone/00-design.md). Never write these via raw $executeRaw again.
        await tx.paymentWebhookEvent.update({
          where: { id: created.id },
          data: {
            processingAttempts: 1,
            processingLeaseOwnerHash: input.leaseOwnerHash,
            processingLeaseExpiresAt: input.leaseExpiresAt,
            retryable: false,
            nextRetryAt: null,
            lastErrorCode: null,
          },
        });
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
        // See CANONICAL_TEMPORAL_AUTHORITY note above: typed client only for lease/retry fields.
        // processed_status/last_error_code CASE/COALESCE logic is evaluated in TS off `existing`,
        // which was read under the row lock (`FOR UPDATE`) held by this same transaction — safe.
        await tx.paymentWebhookEvent.update({
          where: { id: existing.id },
          data: {
            processedStatus: 'FAILED',
            processedAt: new Date(),
            processingLeaseOwnerHash: null,
            processingLeaseExpiresAt: null,
            retryable: false,
            nextRetryAt: null,
            resultCode: 'PROCESSING_ATTEMPTS_EXHAUSTED',
            lastErrorCode: existing.lastErrorCode ?? 'PROCESSING_ATTEMPTS_EXHAUSTED',
          },
        });
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'ATTEMPTS_EXHAUSTED' };
      }

      const attempt = existing.processingAttempts + 1;
      await tx.paymentWebhookEvent.update({
        where: { id: existing.id },
        data: {
          processedStatus: existing.processedStatus === 'FAILED' ? 'PROCESSING' : existing.processedStatus,
          processedAt: null,
          paymentIntentId: existing.paymentIntentId ?? input.paymentIntentId ?? null,
          processingAttempts: attempt,
          processingLeaseOwnerHash: input.leaseOwnerHash,
          processingLeaseExpiresAt: input.leaseExpiresAt,
          retryable: false,
          nextRetryAt: null,
          lastErrorCode: null,
        },
      });
      return {
        state: 'CLAIMED',
        webhookId: existing.id,
        paymentIntentId: existing.paymentIntentId,
        transitionApplied: existing.transitionApplied,
        attempt,
      };
    });
  }

  async findRecoverableWebhookIds(now: Date, limit: number, maxAttempts: number): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    // CANONICAL_TEMPORAL_AUTHORITY: typed Prisma Client only (see claimWebhookEvidence above).
    // `ORDER BY COALESCE(...)` has no typed-client equivalent, so the COALESCE sort key is
    // computed in TS after a typed `findMany` fetch of every matching row, then truncated to
    // `boundedLimit`. `deterministicResult: { equals: Prisma.DbNull }` is the verified (pinned
    // @prisma/client 6.19.2) typed-filter form of `deterministic_result IS NULL` on a nullable
    // Json column — a bare `null` is NOT equivalent for Json? fields in this Prisma version.
    const eligibleStatuses = ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'];
    const candidates = await this.prisma.paymentWebhookEvent.findMany({
      where: {
        signatureValid: true,
        paymentIntentId: { not: null },
        deterministicResult: { equals: Prisma.DbNull },
        processedAt: null,
        processingAttempts: { gt: 0, lte: maxAttempts },
        OR: [
          {
            processedStatus: { in: eligibleStatuses },
            OR: [{ processingLeaseExpiresAt: null }, { processingLeaseExpiresAt: { lte: now } }],
          },
          {
            processedStatus: 'FAILED',
            retryable: true,
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
        ],
      },
      select: { id: true, nextRetryAt: true, processingLeaseExpiresAt: true, receivedAt: true },
    });
    const sortKey = (row: (typeof candidates)[number]) =>
      (row.nextRetryAt ?? row.processingLeaseExpiresAt ?? row.receivedAt).getTime();
    candidates.sort((a, b) => {
      const keyDiff = sortKey(a) - sortKey(b);
      if (keyDiff !== 0) return keyDiff;
      return a.receivedAt.getTime() - b.receivedAt.getTime();
    });
    return candidates.slice(0, boundedLimit).map((row) => row.id);
  }

  async claimRecoverableWebhook(input: {
    webhookId: string;
    leaseOwnerHash: string;
    leaseExpiresAt: Date;
    maxAttempts: number;
  }): Promise<WebhookClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      const lockIdentity = `payment-webhook:${input.webhookId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`;
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
        WHERE event.id = ${input.webhookId}
        FOR UPDATE
      `);
      const existing = rows[0];
      if (!existing) return { state: 'BLOCKED', webhookId: input.webhookId, reasonCode: 'NOT_RETRYABLE' };

      const deterministic = this.canonicalWebhookResult(existing.deterministicResult);
      if (deterministic) return { state: 'REPLAY', webhookId: existing.id, result: deterministic };
      if (existing.processedAt || existing.processingAttempts === 0 || !existing.paymentIntentId) {
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
        // See CANONICAL_TEMPORAL_AUTHORITY note in claimWebhookEvidence — typed client only.
        await tx.paymentWebhookEvent.update({
          where: { id: existing.id },
          data: {
            processedStatus: 'FAILED',
            processedAt: new Date(),
            processingLeaseOwnerHash: null,
            processingLeaseExpiresAt: null,
            retryable: false,
            nextRetryAt: null,
            resultCode: 'PROCESSING_ATTEMPTS_EXHAUSTED',
            lastErrorCode: existing.lastErrorCode ?? 'PROCESSING_ATTEMPTS_EXHAUSTED',
          },
        });
        return { state: 'BLOCKED', webhookId: existing.id, reasonCode: 'ATTEMPTS_EXHAUSTED' };
      }

      const attempt = existing.processingAttempts + 1;
      const updated = await tx.paymentWebhookEvent.updateMany({
        where: { id: existing.id, processedAt: null },
        data: {
          processedStatus: existing.processedStatus === 'FAILED' ? 'PROCESSING' : existing.processedStatus,
          processingAttempts: attempt,
          processingLeaseOwnerHash: input.leaseOwnerHash,
          processingLeaseExpiresAt: input.leaseExpiresAt,
          retryable: false,
          nextRetryAt: null,
          lastErrorCode: null,
        },
      });
      if (updated.count !== 1) {
        return { state: 'ACTIVE', webhookId: existing.id, paymentIntentId: existing.paymentIntentId };
      }
      return {
        state: 'CLAIMED',
        webhookId: existing.id,
        paymentIntentId: existing.paymentIntentId,
        transitionApplied: existing.transitionApplied,
        attempt,
      };
    });
  }

  async findClaimedWebhookEvidence(webhookId: string, leaseOwnerHash: string): Promise<ClaimedWebhookEvidence | null> {
    const event = await this.prisma.paymentWebhookEvent.findFirst({
      where: {
        id: webhookId,
        processedAt: null,
        processingLeaseOwnerHash: leaseOwnerHash,
        processingLeaseExpiresAt: { gt: new Date() },
      },
      include: {
        paymentIntent: { include: { checkout: true } },
        paymentTransition: { select: { id: true } },
      },
    });
    if (!event) return null;
    return {
      id: event.id,
      provider: event.provider,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      providerReference: event.providerReference,
      eventType: event.eventType,
      status: event.status,
      amount: event.amount,
      currency: event.currency,
      signatureValid: event.signatureValid,
      payloadHash: event.payloadHash,
      providerAccountHash: event.providerAccountHash,
      processedStatus: event.processedStatus,
      transitionApplied: Boolean(event.paymentTransition),
      paymentIntent: event.paymentIntent,
    };
  }

  async advanceWebhookCheckpoint(input: {
    webhookId: string;
    leaseOwnerHash: string;
    checkpoint: 'VALIDATED' | 'TRANSITION_APPLIED' | 'DOWNSTREAM_APPLIED';
  }) {
    // CANONICAL_TEMPORAL_AUTHORITY: typed Prisma Client only for processing_lease_expires_at
    // comparisons — see claimWebhookEvidence. Never `> CURRENT_TIMESTAMP` raw SQL again.
    const updated = await this.prisma.paymentWebhookEvent.updateMany({
      where: {
        id: input.webhookId,
        processedAt: null,
        processingLeaseOwnerHash: input.leaseOwnerHash,
        processingLeaseExpiresAt: { gt: new Date() },
      },
      data: {
        processedStatus: input.checkpoint,
        resultCode: input.checkpoint,
      },
    });
    if (updated.count !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async completeWebhookClaim(input: {
    webhookId: string;
    leaseOwnerHash: string;
    result: CanonicalWebhookResult;
  }) {
    const updated = await this.prisma.paymentWebhookEvent.updateMany({
      where: {
        id: input.webhookId,
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: input.leaseOwnerHash,
        processingLeaseExpiresAt: { gt: new Date() },
      },
      data: {
        processedStatus: 'PROCESSED',
        processedAt: new Date(),
        resultCode: input.result.processedStatus,
        deterministicResult: input.result as unknown as Prisma.InputJsonValue,
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        retryable: false,
        nextRetryAt: null,
        lastErrorCode: null,
      },
    });
    if (updated.count !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async assertWebhookClaimOwned(webhookId: string, leaseOwnerHash: string) {
    const count = await this.prisma.paymentWebhookEvent.count({
      where: {
        id: webhookId,
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: leaseOwnerHash,
        processingLeaseExpiresAt: { gt: new Date() },
      },
    });
    if (count !== 1) checkoutConflict('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async renewWebhookClaim(webhookId: string, leaseOwnerHash: string): Promise<Date> {
    const leaseExpiresAt = new Date(Date.now() + 30_000);
    const updated = await this.prisma.paymentWebhookEvent.updateMany({
      where: {
        id: webhookId,
        processedAt: null,
        processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
        processingLeaseOwnerHash: leaseOwnerHash,
        processingLeaseExpiresAt: { gt: new Date() },
      },
      data: { processingLeaseExpiresAt: leaseExpiresAt },
    });
    if (updated.count !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
    return leaseExpiresAt;
  }

  async failWebhookClaim(input: {
    webhookId: string;
    leaseOwnerHash: string;
    errorCode: string;
    maxAttempts: number;
    retryable: boolean;
  }) {
    // The original single-statement raw UPDATE used a data-dependent SQL CASE keyed off the
    // row's *current* processing_attempts, which has no static typed-client `data:` equivalent.
    // Shape: (a) a guarded typed read using the *same* ownership+status+lease-freshness WHERE
    // the raw SQL used, to get processing_attempts/result_code; (b) compute the CASE branches
    // in TS (mirrors the raw SQL verbatim); (c) a guarded typed updateMany with the *same*
    // WHERE for the final write — its count check is the correctness-critical guard, identical
    // safety property to the original single-statement `updated !== 1` check.
    const now = new Date();
    const guardWhere = {
      id: input.webhookId,
      processedStatus: { in: ['PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED'] },
      processingLeaseOwnerHash: input.leaseOwnerHash,
      processingLeaseExpiresAt: { gt: now },
    };
    const current = await this.prisma.paymentWebhookEvent.findFirst({
      where: guardWhere,
      select: { processingAttempts: true, resultCode: true },
    });
    if (!current) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');

    const attemptsExhausted = current.processingAttempts >= input.maxAttempts;
    const stillRetryable = input.retryable && !attemptsExhausted;
    const processedAt = attemptsExhausted || !input.retryable ? new Date() : null;
    const nextRetryAt = stillRetryable ? new Date() : null;
    const resultCode = attemptsExhausted
      ? 'PROCESSING_ATTEMPTS_EXHAUSTED'
      : !input.retryable
        ? input.errorCode
        : current.resultCode;

    const updated = await this.prisma.paymentWebhookEvent.updateMany({
      where: guardWhere,
      data: {
        processedStatus: 'FAILED',
        processedAt,
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        retryable: stillRetryable,
        nextRetryAt,
        resultCode,
        lastErrorCode: input.errorCode,
      },
    });
    if (updated.count !== 1) throw new Error('PAYMENT_WEBHOOK_CLAIM_LOST');
  }

  async findIntentByProvider(input: { provider: PaymentIntentProvider; providerPaymentId?: string | null; providerReference?: string | null }) {
    if (!input.providerPaymentId && !input.providerReference) return null;
    if (input.providerPaymentId) {
      const paymentIdMatch = await this.prisma.paymentIntent.findUnique({
        where: {
          provider_providerPaymentId: {
            provider: input.provider,
            providerPaymentId: input.providerPaymentId,
          },
        },
        include: { checkout: true },
      });
      if (paymentIdMatch) {
        if (
          input.providerReference &&
          paymentIdMatch.providerReference &&
          paymentIdMatch.providerReference !== input.providerReference
        ) {
          return null;
        }
        return paymentIdMatch;
      }
    }
    if (!input.providerReference) return null;
    const matches = await this.prisma.paymentIntent.findMany({
      where: { provider: input.provider, providerReference: input.providerReference },
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
