import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentIntentProvider, PaymentIntentStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import type { CanonicalWebhookResult } from './order-checkout.types';
import {
  PrismaOrderCheckoutRepository,
  type WebhookClaimResult,
  type WebhookEvidenceInput,
} from './persistence/prisma-order-checkout.repository';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { KitchenEligibilityService } from './kitchen-eligibility.service';

type WebhookClaim = WebhookClaimResult | {
  state: 'CLAIMED';
  webhookId: null;
  paymentIntentId: string | null;
  transitionApplied: false;
  attempt: 1;
};

@Injectable()
export class CanonicalPaymentWebhookService {
  private static readonly CLAIM_LEASE_MS = 30_000;
  private static readonly MAX_PROCESSING_ATTEMPTS = 5;

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

    const intent = await this.repository.findIntentByProvider({
      provider,
      providerPaymentId: parsed.providerPaymentId,
      providerReference: parsed.providerReference ?? parsed.orderReference,
    });
    const evidence: WebhookEvidenceInput = {
      paymentIntentId: intent?.id ?? null,
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
      processedStatus: 'RECEIVED',
      rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
    };
    const leaseOwnerHash = this.hash(randomUUID());
    const claim = await this.claimWebhook(evidence, leaseOwnerHash);
    if (claim.state === 'REPLAY') {
      return {
        processedStatus: 'DUPLICATE_REPLAY',
        paymentIntentId: claim.result.paymentIntentId,
        paymentStatus: claim.result.paymentStatus,
      };
    }
    if (claim.state === 'ACTIVE') {
      throw new ServiceUnavailableException({ code: 'PAYMENT_WEBHOOK_PROCESSING_ACTIVE' });
    }
    if (claim.state === 'IDENTITY_CONFLICT') {
      throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_IDENTITY_CONFLICT' });
    }
    if (claim.state === 'BLOCKED') {
      throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_RECOVERY_BLOCKED', reasonCode: claim.reasonCode });
    }

    let webhookId = claim.webhookId;
    try {
      if (!intent) {
        const result: CanonicalWebhookResult = {
          processedStatus: 'REFERENCE_UNKNOWN',
          paymentIntentId: null,
          paymentStatus: null,
        };
        await this.failClaim(
          webhookId,
          leaseOwnerHash,
          new Error('PAYMENT_WEBHOOK_REFERENCE_NOT_BOUND'),
        );
        return result;
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
      } else if (!intent.providerAccountHash || !accountHash || accountHash !== intent.providerAccountHash) {
        processedStatus = 'ACCOUNT_MISMATCH';
        nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
        reasonCode = 'BOLD_ACCOUNT_MISMATCH';
      } else if (intent.status === PaymentIntentStatus.UNKNOWN_RESULT) {
        processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
        nextStatus = PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED;
        reasonCode = 'WEBHOOK_AFTER_UNKNOWN_RESULT_REQUIRES_REVIEW';
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

      if (!webhookId) {
        const webhook = await this.repository.createWebhookEvidence({ ...evidence, processedStatus });
        if (!webhook) throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_PERSISTENCE_FAILED' });
        webhookId = webhook.id;
      }
      let updatedStatus = intent.status;
      if (intent.status === nextStatus) {
        if (!claim.transitionApplied) processedStatus = 'DUPLICATE_REPLAY';
      } else {
        const updated = await this.repository.transitionPayment({
          paymentIntentId: intent.id,
          expectedVersion: intent.version,
          toStatus: nextStatus,
          reasonCode,
          idempotencyKey: parsed.eventId ? `webhook:${provider}:${parsed.eventId}` : `webhook-hash:${payloadHash}`,
          webhookEventId: webhookId,
          providerPaymentId: parsed.providerPaymentId,
          providerReference: parsed.providerReference,
          metadata: { provider, eventType: parsed.eventType, processedStatus },
          webhookClaim: { webhookId, leaseOwnerHash },
        });
        updatedStatus = updated.status;
      }

      if (updatedStatus === PaymentIntentStatus.SUCCEEDED) {
        await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
        const successes = await this.repository.successfulPaymentCount(intent.checkoutId);
        if (successes > 1) {
          await this.repository.markFinancialReview(intent.checkoutId, 'MULTIPLE_SUCCESSFUL_PAYMENTS');
          processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
        } else {
          await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
          await this.repository.markCheckoutPaymentVerified(intent.checkoutId);
          await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
          await this.kitchen.evaluateAndMark(intent.checkoutId, null);
        }
      }
      const result: CanonicalWebhookResult = {
        processedStatus,
        paymentIntentId: intent.id,
        paymentStatus: updatedStatus,
      };
      await this.completeClaim(webhookId, leaseOwnerHash, result);
      return result;
    } catch (error) {
      await this.failClaim(webhookId, leaseOwnerHash, error);
      throw error;
    }
  }

  private async claimWebhook(input: WebhookEvidenceInput, leaseOwnerHash: string): Promise<WebhookClaim> {
    const recovery = this.repository as Partial<Pick<
      PrismaOrderCheckoutRepository,
      'claimWebhookEvidence'
    >>;
    if (typeof recovery.claimWebhookEvidence !== 'function') {
      if (input.eventId) {
        const replay = await this.repository.findWebhook(input.provider, input.eventId);
        if (replay) {
          return {
            state: 'REPLAY',
            webhookId: replay.id,
            result: { processedStatus: 'DUPLICATE_REPLAY', paymentIntentId: replay.paymentIntentId, paymentStatus: null },
          };
        }
      }
      return { state: 'CLAIMED', webhookId: null, paymentIntentId: input.paymentIntentId ?? null, transitionApplied: false, attempt: 1 };
    }
    return recovery.claimWebhookEvidence({
      ...input,
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + CanonicalPaymentWebhookService.CLAIM_LEASE_MS),
      maxAttempts: CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
    });
  }

  private async completeClaim(webhookId: string | null, leaseOwnerHash: string, result: CanonicalWebhookResult) {
    if (!webhookId) return;
    const recovery = this.repository as Partial<Pick<
      PrismaOrderCheckoutRepository,
      'completeWebhookClaim'
    >>;
    await recovery.completeWebhookClaim?.({ webhookId, leaseOwnerHash, result });
  }

  private async failClaim(webhookId: string | null, leaseOwnerHash: string, error: unknown) {
    if (!webhookId) return;
    const recovery = this.repository as Partial<Pick<
      PrismaOrderCheckoutRepository,
      'failWebhookClaim'
    >>;
    const errorCode = this.errorCode(error);
    await recovery.failWebhookClaim?.({
      webhookId,
      leaseOwnerHash,
      errorCode,
      maxAttempts: CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
      retryable: !errorCode.includes('UNKNOWN_RESULT') && !errorCode.includes('IDENTITY_CONFLICT'),
    });
  }

  private errorCode(error: unknown) {
    if (error && typeof error === 'object') {
      const response = 'response' in error ? error.response : null;
      if (response && typeof response === 'object' && 'code' in response && typeof response.code === 'string') {
        return this.sanitizeErrorCode(response.code);
      }
      if ('message' in error && typeof error.message === 'string') return this.sanitizeErrorCode(error.message);
    }
    return 'PAYMENT_WEBHOOK_PROCESSING_FAILED';
  }

  private sanitizeErrorCode(value: string) {
    return /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'PAYMENT_WEBHOOK_PROCESSING_FAILED';
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
