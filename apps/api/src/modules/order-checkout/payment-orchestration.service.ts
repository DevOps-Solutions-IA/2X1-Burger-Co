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
import type { CreateOnlinePaymentCommand, PaymentIntentView } from './order-checkout.types';
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
    this.assertRelinkAllowed(checkout, checkout.paymentIntents, input.idempotencyKey);
    const expiresAt = new Date(Date.now() + this.paymentTtlMinutes() * 60_000);
    const intent = await withBoundedTransactionRetry(() =>
      this.repository.createPaymentIntent({
        checkoutId: checkout.id,
        idempotencyKey: input.idempotencyKey,
        provider: PaymentIntentProvider.BOLD,
        expiresAt,
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
   * PK4 (Recovery / Expiration) re-link / retry policy: a checkout may have at most one
   * non-terminal PaymentIntent at a time, and may never accept a new attempt once it has left the
   * payable window (CONFIRMED / PAYMENT_PENDING). This is the upstream guard that keeps
   * CAN_MULTIPLE_ACTIVE_LINKS_EXIST = No and CAN_MULTIPLE_SUCCESSFUL_PAYMENTS_EXIST = No at the
   * point of creation, complementing (never replacing) the existing downstream financial safety
   * net in CanonicalPaymentWebhookService (successfulPaymentCount / markFinancialReview), which
   * remains untouched and is still the last-resort backstop for paths that bypass this service.
   *
   * - Replaying the *same* command idempotencyKey is always allowed and checked first, before any
   *   checkout-state check: it falls straight through to repository.createPaymentIntent's own
   *   idempotent replay (the `provider_idempotencyKey` unique-key lookup), unchanged by this guard.
   *   This preserves existing lost-response recovery semantics even if the checkout has since
   *   expired -- a client retrying its own already-accepted request must still get back the same
   *   result, never a fresh conflict.
   * - A *new* attempt (new idempotencyKey) is rejected (CHECKOUT_NOT_PAYABLE) once the checkout has
   *   left CONFIRMED/PAYMENT_PENDING -- e.g. KITCHEN_ELIGIBLE, ORDER_CREATED, CANCELLED, EXPIRED,
   *   FINANCIAL_REVIEW_REQUIRED, or PAYMENT_VERIFIED. Payment is either already resolved or the
   *   checkout is otherwise terminal; no new attempt is ever appropriate.
   * - A *new* attempt is rejected (CHECKOUT_EXPIRED) once checkout.expiresAt has elapsed, checked
   *   synchronously here at call time -- this does not depend on PaymentExpirationWorker having
   *   already run its sweep, so the guard is correct even if the worker is disabled or lagging.
   * - A *new* attempt is blocked (PAYMENT_ATTEMPT_ACTIVE) while the latest attempt is still
   *   CREATED / LINK_READY / PENDING *and* its own TTL has not elapsed -- i.e. genuinely in flight
   *   or awaiting a result.
   * - A *new* attempt is permanently blocked (PAYMENT_RELINK_BLOCKED, never auto-retried) while the
   *   latest attempt is UNKNOWN_RESULT, FINANCIAL_REVIEW_REQUIRED, or SUCCEEDED -- all three require
   *   human reconciliation, never a blind retry that could risk a second charge.
   * - A fresh attempt (re-link) is allowed once the latest attempt has reached a genuinely
   *   retryable terminal state: EXPIRED, FAILED, CANCELLED, or -- checked synchronously here too --
   *   a CREATED/LINK_READY/PENDING attempt whose own expiresAt has already elapsed even though
   *   PaymentExpirationWorker has not yet swept it to EXPIRED. PaymentExpirationWorker still drives
   *   the durable status transition (for audit/reporting and to unblock this same checkout for
   *   readers that only look at persisted status), but re-link never has to wait on it.
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

    const latest = paymentIntents[0];
    if (!latest) return;
    const active: PaymentIntentStatus[] = [
      PaymentIntentStatus.CREATED,
      PaymentIntentStatus.LINK_READY,
      PaymentIntentStatus.PENDING,
    ];
    const blocked: PaymentIntentStatus[] = [
      PaymentIntentStatus.UNKNOWN_RESULT,
      PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
      PaymentIntentStatus.SUCCEEDED,
    ];
    const lazilyExpired =
      active.includes(latest.status) && latest.expiresAt != null && latest.expiresAt.getTime() <= Date.now();
    if (active.includes(latest.status) && !lazilyExpired) checkoutConflict('PAYMENT_ATTEMPT_ACTIVE');
    if (blocked.includes(latest.status)) checkoutConflict('PAYMENT_RELINK_BLOCKED');
    // EXPIRED / FAILED / CANCELLED / lazily-expired active -> retryable, fall through to create a
    // fresh attempt.
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
