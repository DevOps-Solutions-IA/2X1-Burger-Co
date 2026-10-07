import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OrderCheckoutStatus,
  PaymentIntentProvider,
  PaymentIntentStatus,
  PaymentLinkStatus,
  SofiaPaymentPreference,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import { CheckoutPolicyService } from './checkout-policy.service';
import { checkoutConflict } from './order-checkout.errors';
import type { CreateOnlinePaymentCommand, PaymentIntentRelinkPolicy, PaymentIntentView } from './order-checkout.types';
import { PaymentPublicReferenceService } from './payment-public-reference.service';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';
import { withBoundedTransactionRetry } from './transaction-retry';

@Injectable()
export class PaymentOrchestrationService {
  constructor(
    private readonly repository: PrismaOrderCheckoutRepository,
    private readonly policy: CheckoutPolicyService,
    private readonly gate: Phase5RuntimeGate,
    private readonly bold: BoldPaymentProvider,
    private readonly audit: AuditService,
    private readonly publicReferences: PaymentPublicReferenceService,
  ) {}

  async createOnlinePaymentLink(input: CreateOnlinePaymentCommand) {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const checkout = await this.repository.requiredCheckout(input.checkoutId);
    this.policy.assertPaymentCombination(checkout.fulfillment, checkout.paymentPreference);
    if (checkout.paymentPreference !== SofiaPaymentPreference.ONLINE) {
      checkoutConflict('CHECKOUT_PAYMENT_COMBINATION_INVALID');
    }
    // PaymentIntent TOCTOU remediation: the "at most one active/blocked attempt per checkout"
    // check must run against fresh, locked state, never against this pre-transaction `checkout`
    // read (which can be stale by the time the transaction below actually acquires the row
    // lock on `order_checkouts`). The policy is passed as a callback so the repository's
    // `createPaymentIntent` transaction can invoke it immediately after the `FOR UPDATE` lock +
    // a fresh `PaymentIntent` re-read, before the `(provider, idempotencyKey)` replay lookup and
    // before creating a new intent. There is no pre-transaction call here -- keeping one as a
    // "fast path" would reintroduce the same race for any caller whose stale read happens to
    // pass it.
    const relinkPolicy: PaymentIntentRelinkPolicy = (lockedCheckout, currentPaymentIntents) =>
      this.assertRelinkAllowed(lockedCheckout, currentPaymentIntents, input.idempotencyKey);
    const expiresAt = new Date(Date.now() + this.paymentTtlMinutes() * 60_000);
    const intent = await withBoundedTransactionRetry(() =>
      this.repository.createPaymentIntent({
        checkoutId: checkout.id,
        idempotencyKey: input.idempotencyKey,
        provider: PaymentIntentProvider.BOLD,
        expiresAt,
        relinkPolicy,
      }),
    );
    const existingLink = await this.repository.findActivePaymentLink(intent.id);
    if (existingLink) {
      return {
        paymentIntent: this.intentView(intent),
        publicPath: this.publicPath(existingLink),
        expiresAt: existingLink.expiresAt,
        replayed: true,
      };
    }
    const token = randomBytes(32).toString('base64url');
    const linkResult = await this.repository.createPaymentLink({
      paymentIntentId: intent.id,
      tokenHash: this.hash(token),
      expiresAt,
    });
    const readyIntent = await this.repository.findPaymentIntent(intent.id);
    if (!linkResult.created) {
      return {
        paymentIntent: this.intentView(readyIntent),
        publicPath: this.publicPath(linkResult.link),
        expiresAt: linkResult.link.expiresAt,
        replayed: true,
      };
    }
    await this.audit.log({
      userId: input.actorId,
      action: 'PAYMENT_LINK_CREATED',
      module: 'order-checkout',
      entity: 'payment_link',
      entityId: linkResult.link.id,
      result: 'SUCCESS',
      reasonCode: 'TOKEN_HASH_ONLY',
      idempotencyKey: input.idempotencyKey,
      newValues: { paymentIntentId: intent.id, expiresAt, tokenPersisted: false },
    });
    return {
      paymentIntent: this.intentView(readyIntent),
      publicPath: this.publicPath(linkResult.link),
      expiresAt,
      replayed: false,
    };
  }

  async startBoldPayment(publicReference: string) {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const link = await this.resolvePaymentLink(publicReference);
    const intent = link.paymentIntent;
    if (intent.status === PaymentIntentStatus.UNKNOWN_RESULT || intent.status === PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED) {
      checkoutConflict(intent.status === PaymentIntentStatus.UNKNOWN_RESULT ? 'PAYMENT_UNKNOWN_RESULT' : 'PAYMENT_FINANCIAL_REVIEW_REQUIRED');
    }
    if (intent.status !== PaymentIntentStatus.CREATED && intent.status !== PaymentIntentStatus.LINK_READY) {
      return { paymentIntent: this.intentView(intent), checkoutUrl: null, replayed: true };
    }
    const checkout = intent.checkout;
    const customer = this.object(checkout.customerSnapshot);
    const providerReference = this.boldProviderReference(intent.id);
    const beginning = await this.repository.beginProviderPayment({
      paymentIntentId: intent.id,
      expectedVersion: intent.version,
      providerReference,
      providerAccountHash: this.expectedProviderAccountHash(),
      idempotencyKey: `${intent.id}:provider-requested`,
    });
    if (!beginning.started) {
      return { paymentIntent: this.intentView(beginning.paymentIntent), checkoutUrl: null, replayed: true };
    }

    let payment: Awaited<ReturnType<BoldPaymentProvider['createPayment']>>;
    try {
      payment = await this.bold.createPayment({
        orderReference: providerReference,
        amount: Number(checkout.total),
        currency: 'COP',
        customerName: typeof customer.name === 'string' ? customer.name : null,
        customerPhone: null,
        description: `2X1 checkout ${checkout.id}`,
        metadata: { checkoutId: checkout.id, paymentIntentId: intent.id },
      });
    } catch {
      return this.handleUnknownProviderResult(intent.id, providerReference);
    }
    if (payment.providerReference !== providerReference) {
      return this.handleUnknownProviderResult(intent.id, providerReference);
    }
    const updated = await this.repository.bindProviderPaymentResult({
      paymentIntentId: intent.id,
      providerReference,
      providerPaymentId: payment.providerPaymentId,
    });
    await this.repository.markPaymentLinkOpened(link.id);
    return { paymentIntent: this.intentView(updated), checkoutUrl: payment.checkoutUrl, replayed: false };
  }

  async getPublicPayment(publicReference: string) {
    const link = await this.resolvePaymentLink(publicReference);
    const checkout = link.paymentIntent.checkout;
    return {
      expired: false,
      orderReference: checkout.sourceReference,
      items: checkout.itemsSnapshot,
      subtotal: Number(checkout.subtotal),
      deliveryFee: Number(checkout.deliveryFee),
      total: Number(checkout.total),
      currency: checkout.currency,
      fulfillment: checkout.fulfillment,
      paymentPreference: checkout.paymentPreference,
      paymentStatus: link.paymentIntent.status,
      availablePaymentMethods: [{ method: 'ONLINE', label: 'Pago en línea', description: 'Pago seguro con Bold.', enabled: false }],
      expiresAt: link.expiresAt,
      source: checkout.source,
      message: 'El pago productivo permanece bloqueado hasta la activación controlada.',
    };
  }

  /**
   * PaymentIntent TOCTOU remediation -- re-link / retry policy: a checkout may have at most one
   * non-terminal PaymentIntent at a time, and may never accept a new attempt once it has left
   * the payable window (CONFIRMED / PAYMENT_PENDING). This is the upstream guard that keeps
   * "at most one active link" and "at most one successful payment" true at the point of
   * creation, complementing (never replacing) the existing downstream financial safety net in
   * CanonicalPaymentWebhookService (successfulPaymentCount / markFinancialReview), which remains
   * untouched and is still the last-resort backstop for paths that bypass this service.
   *
   * MUST be invoked only by the repository, inside the `createPaymentIntent` transaction,
   * immediately after the `order_checkouts` row lock (`FOR UPDATE`) and a fresh re-read of both
   * the checkout and every PaymentIntent for it (see `PaymentIntentRelinkPolicy` in
   * order-checkout.types.ts). Never call this against a pre-transaction read.
   *
   * - Replaying the *same* command idempotencyKey is always allowed and checked first, before
   *   any checkout-state check: it falls straight through to repository.createPaymentIntent's
   *   own idempotent replay (the `provider_idempotencyKey` unique-key lookup), unchanged by this
   *   guard. This preserves existing lost-response recovery semantics even if the checkout has
   *   since expired -- a client retrying its own already-accepted request must still get back
   *   the same result, never a fresh conflict.
   * - A *new* attempt (new idempotencyKey) is rejected (CHECKOUT_NOT_PAYABLE) once the checkout
   *   has left CONFIRMED/PAYMENT_PENDING -- e.g. KITCHEN_ELIGIBLE, ORDER_CREATED, CANCELLED,
   *   EXPIRED, FINANCIAL_REVIEW_REQUIRED, or PAYMENT_VERIFIED. Payment is either already resolved
   *   or the checkout is otherwise terminal; no new attempt is ever appropriate.
   * - A *new* attempt is rejected (CHECKOUT_EXPIRED) once checkout.expiresAt has elapsed, checked
   *   synchronously here at call time.
   * - EVERY PaymentIntent on the checkout is evaluated, not just the latest attempt by
   *   `attemptNumber`: the invariant is "no active or blocked intent anywhere in the checkout's
   *   history", not "the single most recent one is clean". A checkout can otherwise accumulate
   *   an active attempt N alongside a terminal (FAILED/CANCELLED/EXPIRED) attempt N+1 -- e.g. a
   *   crashed/short-circuited client retried with a fresh idempotencyKey that itself failed fast
   *   -- and a naive "only look at the latest" check would let a THIRD attempt through while the
   *   first is still chargeable.
   * - For each intent with status CREATED or LINK_READY: blocked (PAYMENT_ATTEMPT_ACTIVE) while
   *   genuinely in flight (its own TTL has not elapsed). Once its own `expiresAt` has elapsed
   *   (lazy expiry -- this codebase has no PaymentExpirationWorker sweeping these to EXPIRED),
   *   it never issued a live provider checkout URL, so it is safe to treat as retryable and
   *   skip it.
   * - For each intent with status PENDING: this status is reached ONLY after
   *   `beginProviderPayment` + `BoldPaymentProvider.createPayment` already ran and handed the
   *   client a live `checkoutUrl` -- a real, potentially still-payable provider-side reference.
   *   Unlike CREATED/LINK_READY, a PENDING intent is NEVER treated as "lazily expired -> safe to
   *   relink": nothing in this codebase calls `revokePaymentLink` (no such capability exists), so
   *   an elapsed local TTL does not mean the Bold-side checkout is dead. While within its own TTL
   *   it blocks the same as any other active intent (PAYMENT_ATTEMPT_ACTIVE); once that TTL
   *   elapses it is permanently blocked (PAYMENT_RELINK_BLOCKED) pending human reconciliation,
   *   exactly like UNKNOWN_RESULT -- never an automatic second link that could create two
   *   simultaneously chargeable references for the same checkout (CLAUDE.md Sec.15, no duplicate
   *   charge).
   * - For each intent with status UNKNOWN_RESULT, FINANCIAL_REVIEW_REQUIRED, or SUCCEEDED:
   *   permanently blocked (PAYMENT_RELINK_BLOCKED) -- all three require human reconciliation,
   *   never a blind retry that could risk a second charge.
   * - Intents in EXPIRED, FAILED, or CANCELLED never block anything; they are simply skipped.
   * - A fresh attempt is allowed only once every intent on the checkout has cleared the checks
   *   above.
   */
  private assertRelinkAllowed(
    checkout: { status: OrderCheckoutStatus; expiresAt: Date | null },
    paymentIntents: readonly { idempotencyKey: string; status: PaymentIntentStatus; expiresAt: Date | null }[],
    idempotencyKey: string,
  ) {
    if (paymentIntents.some((intent) => intent.idempotencyKey === idempotencyKey)) return;
    const payableCheckoutStatuses: OrderCheckoutStatus[] = [
      OrderCheckoutStatus.CONFIRMED,
      OrderCheckoutStatus.PAYMENT_PENDING,
    ];
    if (!payableCheckoutStatuses.includes(checkout.status)) checkoutConflict('CHECKOUT_NOT_PAYABLE');
    if (checkout.expiresAt && checkout.expiresAt.getTime() <= Date.now()) checkoutConflict('CHECKOUT_EXPIRED');

    // Lazily-expirable active statuses: never issued a live provider checkout URL, so an elapsed
    // own TTL makes them safely skippable (no revocation needed, nothing was ever payable).
    const lazilyExpirableActive: PaymentIntentStatus[] = [
      PaymentIntentStatus.CREATED,
      PaymentIntentStatus.LINK_READY,
    ];
    // Permanently blocked, regardless of any TTL -- all three require human reconciliation.
    const blocked: PaymentIntentStatus[] = [
      PaymentIntentStatus.UNKNOWN_RESULT,
      PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
      PaymentIntentStatus.SUCCEEDED,
    ];
    const stillWithinOwnTtl = (intent: { expiresAt: Date | null }) =>
      intent.expiresAt == null || intent.expiresAt.getTime() > Date.now();

    // ALTO-2 fix: evaluate every PaymentIntent for this checkout, not just the most recent
    // attempt -- any single active or blocked intent anywhere in the checkout's history must
    // stop a new one from being created.
    for (const intent of paymentIntents) {
      if (lazilyExpirableActive.includes(intent.status)) {
        if (stillWithinOwnTtl(intent)) checkoutConflict('PAYMENT_ATTEMPT_ACTIVE');
        continue; // lazily expired -> never issued a live checkout URL -> safe to skip.
      }
      if (intent.status === PaymentIntentStatus.PENDING) {
        // ALTO-1 fix: PENDING already has a live, potentially still-payable Bold checkoutUrl in
        // the client's hands. It must never be treated as lazily-expired-therefore-retryable --
        // there is no revokePaymentLink call anywhere in this codebase. Within its own TTL it is
        // genuinely in flight; once that TTL elapses it requires human reconciliation, never an
        // automatic second link.
        checkoutConflict(stillWithinOwnTtl(intent) ? 'PAYMENT_ATTEMPT_ACTIVE' : 'PAYMENT_RELINK_BLOCKED');
      }
      if (blocked.includes(intent.status)) checkoutConflict('PAYMENT_RELINK_BLOCKED');
      // EXPIRED / FAILED / CANCELLED -> never blocks anything, continue checking the rest.
    }
  }

  private paymentTtlMinutes() {
    return Math.min(Math.max(Number(process.env.BOLD_PAYMENT_LINK_TTL_MINUTES ?? 20), 1), 1440);
  }

  private expectedProviderAccountHash() {
    const account = process.env.BOLD_EXPECTED_ACCOUNT_ID?.trim();
    return account ? this.hash(account) : null;
  }

  private boldProviderReference(paymentIntentId: string) {
    return `checkout_${paymentIntentId}`;
  }

  private async handleUnknownProviderResult(paymentIntentId: string, providerReference: string) {
    const result = await this.repository.markProviderPaymentUnknown({
      paymentIntentId,
      providerReference,
      idempotencyKey: `${paymentIntentId}:unknown-result`,
    });
    if (!result.marked && result.paymentIntent.status !== PaymentIntentStatus.UNKNOWN_RESULT) {
      return { paymentIntent: this.intentView(result.paymentIntent), checkoutUrl: null, replayed: true };
    }
    throw new BadRequestException({ code: 'PAYMENT_UNKNOWN_RESULT', paymentIntentId: result.paymentIntent.id });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private publicPath(link: { id: string; expiresAt: Date }) {
    return `/pagos/${this.publicReferences.issue({ linkId: link.id, expiresAt: link.expiresAt })}`;
  }

  private async resolvePaymentLink(publicReference: string) {
    const verified = this.publicReferences.verify(publicReference);
    if (!verified || verified.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException({ code: 'PAYMENT_LINK_NOT_FOUND' });
    }
    const link = await this.repository.findPaymentLinkById(verified.linkId);
    if (
      !link ||
      link.expiresAt.getTime() !== verified.expiresAt.getTime() ||
      link.expiresAt.getTime() <= Date.now() ||
      link.revokedAt ||
      (link.status !== PaymentLinkStatus.ACTIVE && link.status !== PaymentLinkStatus.OPENED)
    ) {
      throw new NotFoundException({ code: 'PAYMENT_LINK_NOT_FOUND' });
    }
    return link;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private intentView(intent: {
    id: string;
    checkoutId: string;
    attemptNumber: number;
    provider: PaymentIntentProvider;
    status: PaymentIntentStatus;
    amount: { toString(): string };
    currency: string;
    providerPaymentId: string | null;
    providerReference: string | null;
    expiresAt: Date | null;
  }): PaymentIntentView {
    return {
      id: intent.id,
      checkoutId: intent.checkoutId,
      attemptNumber: intent.attemptNumber,
      provider: intent.provider,
      status: intent.status,
      amount: Number(intent.amount.toString()),
      currency: intent.currency,
      providerPaymentId: intent.providerPaymentId,
      providerReference: intent.providerReference,
      expiresAt: intent.expiresAt,
    };
  }
}
