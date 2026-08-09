import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentIntentProvider, PaymentIntentStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import type { CanonicalWebhookResult } from './order-checkout.types';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { KitchenEligibilityService } from './kitchen-eligibility.service';

@Injectable()
export class CanonicalPaymentWebhookService {
  constructor(
    private readonly repository: PrismaOrderCheckoutRepository,
    private readonly bold: BoldPaymentProvider,
    private readonly gate: Phase5RuntimeGate,
    private readonly kitchen: KitchenEligibilityService,
  ) {}

  async processBold(input: {
    rawPayload: unknown;
    rawBody?: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<CanonicalWebhookResult> {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const parsed = this.bold.parseWebhook(input.rawPayload);
    const signatureValid = this.bold.verifyWebhookSignature(input.rawPayload, input.headers, input.rawBody);
    const payloadHash = this.hash(input.rawBody ?? Buffer.from(JSON.stringify(parsed.rawPayload)));
    const provider = PaymentIntentProvider.BOLD;
    const accountHash = this.accountHash(input.headers);

    if (!signatureValid) {
      await this.repository.createWebhookEvidence({
        provider,
        eventId: null,
        providerPaymentId: parsed.providerPaymentId,
        providerReference: parsed.providerReference,
        eventType: parsed.eventType,
        status: parsed.status,
        amount: parsed.amount,
        currency: parsed.currency,
        signatureValid: false,
        payloadHash,
        providerAccountHash: accountHash,
        processedStatus: 'SIGNATURE_INVALID',
        rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
      });
      return { processedStatus: 'SIGNATURE_INVALID', paymentIntentId: null, paymentStatus: null };
    }

    if (parsed.eventId) {
      const replay = await this.repository.findWebhook(provider, parsed.eventId);
      if (replay) {
        return {
          processedStatus: 'DUPLICATE_REPLAY',
          paymentIntentId: replay.paymentIntentId,
          paymentStatus: null,
        };
      }
    }

    const intent = await this.repository.findIntentByProvider({
      provider,
      providerPaymentId: parsed.providerPaymentId,
      providerReference: parsed.providerReference ?? parsed.orderReference,
    });
    if (!intent) {
      await this.repository.createWebhookEvidence({
        provider,
        eventId: parsed.eventId,
        providerPaymentId: parsed.providerPaymentId,
        providerReference: parsed.providerReference,
        eventType: parsed.eventType,
        status: parsed.status,
        amount: parsed.amount,
        currency: parsed.currency,
        signatureValid: true,
        payloadHash,
        providerAccountHash: accountHash,
        processedStatus: 'REFERENCE_UNKNOWN',
        rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
      });
      return { processedStatus: 'REFERENCE_UNKNOWN', paymentIntentId: null, paymentStatus: null };
    }

    let processedStatus: CanonicalWebhookResult['processedStatus'] = 'PROCESSED';
    let nextStatus: PaymentIntentStatus = PaymentIntentStatus.PENDING;
    let reasonCode = 'BOLD_WEBHOOK_PENDING';
    if (parsed.amount == null || parsed.amount !== Number(intent.amount)) {
      processedStatus = 'AMOUNT_MISMATCH';
      nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
      reasonCode = 'BOLD_AMOUNT_MISMATCH';
    } else if (parsed.currency !== intent.currency) {
      processedStatus = 'CURRENCY_MISMATCH';
      nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
      reasonCode = 'BOLD_CURRENCY_MISMATCH';
    } else if (intent.providerAccountHash && accountHash !== intent.providerAccountHash) {
      processedStatus = 'ACCOUNT_MISMATCH';
      nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
      reasonCode = 'BOLD_ACCOUNT_MISMATCH';
    } else if (parsed.status === 'APPROVED') {
      if (intent.checkout.status === 'CANCELLED' || intent.checkout.status === 'EXPIRED') {
        processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
        nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
        reasonCode = 'PAYMENT_AFTER_CHECKOUT_TERMINAL';
      } else {
        nextStatus = PaymentIntentStatus.SUCCEEDED;
        reasonCode = 'BOLD_PAYMENT_VERIFIED';
      }
    } else if (parsed.status === 'FAILED') {
      nextStatus = PaymentIntentStatus.FAILED;
      reasonCode = 'BOLD_PAYMENT_FAILED';
    } else if (parsed.status === 'REVIEW') {
      processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
      nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
      reasonCode = 'BOLD_PROVIDER_REVIEW';
    }

    const webhook = await this.repository.createWebhookEvidence({
      paymentIntentId: intent.id,
      provider,
      eventId: parsed.eventId,
      providerPaymentId: parsed.providerPaymentId,
      providerReference: parsed.providerReference,
      eventType: parsed.eventType,
      status: parsed.status,
      amount: parsed.amount,
      currency: parsed.currency,
      signatureValid: true,
      payloadHash,
      providerAccountHash: accountHash,
      processedStatus,
      rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
    });
    if (!webhook) throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_PERSISTENCE_FAILED' });
    if (intent.status === PaymentIntentStatus.SUCCEEDED && nextStatus === PaymentIntentStatus.SUCCEEDED) {
      return { processedStatus: 'DUPLICATE_REPLAY', paymentIntentId: intent.id, paymentStatus: intent.status };
    }
    const updated = await this.repository.transitionPayment({
      paymentIntentId: intent.id,
      expectedVersion: intent.version,
      toStatus: nextStatus,
      reasonCode,
      idempotencyKey: parsed.eventId ? `webhook:${provider}:${parsed.eventId}` : `webhook-hash:${payloadHash}`,
      webhookEventId: webhook.id,
      providerPaymentId: parsed.providerPaymentId,
      providerReference: parsed.providerReference,
      providerAccountHash: accountHash,
      metadata: { provider, eventType: parsed.eventType, processedStatus },
    });

    if (updated.status === PaymentIntentStatus.SUCCEEDED) {
      const successes = await this.repository.successfulPaymentCount(intent.checkoutId);
      if (successes > 1) {
        await this.repository.markFinancialReview(intent.checkoutId, 'MULTIPLE_SUCCESSFUL_PAYMENTS');
        processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
      } else {
        await this.repository.markCheckoutPaymentVerified(intent.checkoutId);
        await this.kitchen.evaluateAndMark(intent.checkoutId, null);
      }
    }
    return { processedStatus, paymentIntentId: intent.id, paymentStatus: updated.status };
  }

  private accountHash(headers: Record<string, string | string[] | undefined>) {
    const raw = headers['x-bold-merchant-id'] ?? headers['X-Bold-Merchant-Id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value?.trim() ? this.hash(value.trim()) : null;
  }

  private hash(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex');
  }
}
