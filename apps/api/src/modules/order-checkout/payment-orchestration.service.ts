import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentIntentProvider, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import { CheckoutPolicyService } from './checkout-policy.service';
import { checkoutConflict } from './order-checkout.errors';
import type { CreateOnlinePaymentCommand, PaymentIntentView } from './order-checkout.types';
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
  ) {}

  async createOnlinePaymentLink(input: CreateOnlinePaymentCommand) {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const checkout = await this.repository.requiredCheckout(input.checkoutId);
    this.policy.assertPaymentCombination(checkout.fulfillment, checkout.paymentPreference);
    if (checkout.paymentPreference !== SofiaPaymentPreference.ONLINE) {
      checkoutConflict('CHECKOUT_PAYMENT_COMBINATION_INVALID');
    }
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
        publicPath: null,
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
        publicPath: null,
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
      publicPath: `/pagos/${token}`,
      expiresAt,
      replayed: false,
    };
  }

  async startBoldPayment(publicToken: string) {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const link = await this.repository.findPaymentLink(this.hash(publicToken));
    if (!link || link.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'PAYMENT_LINK_EXPIRED' });
    }
    const intent = link.paymentIntent;
    if (intent.status === PaymentIntentStatus.UNKNOWN_RESULT || intent.status === PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED) {
      checkoutConflict(intent.status === PaymentIntentStatus.UNKNOWN_RESULT ? 'PAYMENT_UNKNOWN_RESULT' : 'PAYMENT_FINANCIAL_REVIEW_REQUIRED');
    }
    if (intent.status !== PaymentIntentStatus.CREATED && intent.status !== PaymentIntentStatus.LINK_READY) {
      return { paymentIntent: this.intentView(intent), checkoutUrl: null, replayed: true };
    }
    const checkout = intent.checkout;
    const customer = this.object(checkout.customerSnapshot);
    try {
      const payment = await this.bold.createPayment({
        orderReference: `checkout_${checkout.id}`,
        amount: Number(checkout.total),
        currency: 'COP',
        customerName: typeof customer.name === 'string' ? customer.name : null,
        customerPhone: null,
        description: `2X1 checkout ${checkout.id}`,
        metadata: { checkoutId: checkout.id, paymentIntentId: intent.id },
      });
      const updated = await this.repository.transitionPayment({
        paymentIntentId: intent.id,
        expectedVersion: intent.version,
        toStatus: PaymentIntentStatus.PENDING,
        reasonCode: 'BOLD_PAYMENT_CREATED',
        idempotencyKey: `${intent.id}:provider-created`,
        providerPaymentId: payment.providerPaymentId,
        providerReference: payment.providerReference,
        providerAccountHash: this.expectedProviderAccountHash(),
        metadata: { provider: payment.provider, providerStatus: payment.status },
      });
      await this.repository.markPaymentLinkOpened(link.id);
      return { paymentIntent: this.intentView(updated), checkoutUrl: payment.checkoutUrl, replayed: false };
    } catch {
      const updated = await this.repository.transitionPayment({
        paymentIntentId: intent.id,
        expectedVersion: intent.version,
        toStatus: PaymentIntentStatus.UNKNOWN_RESULT,
        reasonCode: 'BOLD_CREATE_UNKNOWN_RESULT',
        idempotencyKey: `${intent.id}:unknown-result`,
        metadata: { retryAllowed: false },
      });
      throw new BadRequestException({ code: 'PAYMENT_UNKNOWN_RESULT', paymentIntentId: updated.id });
    }
  }

  async getPublicPayment(publicToken: string) {
    const link = await this.repository.findPaymentLink(this.hash(publicToken));
    if (!link) throw new NotFoundException({ code: 'PAYMENT_LINK_NOT_FOUND' });
    const checkout = link.paymentIntent.checkout;
    return {
      expired: link.expiresAt.getTime() <= Date.now(),
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

  private paymentTtlMinutes() {
    return Math.min(Math.max(Number(process.env.BOLD_PAYMENT_LINK_TTL_MINUTES ?? 20), 1), 1440);
  }

  private expectedProviderAccountHash() {
    const account = process.env.BOLD_EXPECTED_ACCOUNT_ID?.trim();
    return account ? this.hash(account) : null;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
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
