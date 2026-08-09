import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentIntentProvider, PaymentIntentStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import { KitchenEligibilityService } from './kitchen-eligibility.service';
import type { CanonicalWebhookResult } from './order-checkout.types';
import {
  PrismaOrderCheckoutRepository,
  type ClaimedWebhookEvidence,
  type WebhookClaimResult,
  type WebhookEvidenceInput,
} from './persistence/prisma-order-checkout.repository';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';

type WebhookClaim = WebhookClaimResult | {
  state: 'CLAIMED';
  webhookId: null;
  paymentIntentId: string | null;
  transitionApplied: false;
  attempt: 1;
};

type WebhookDecision = {
  processedStatus: CanonicalWebhookResult['processedStatus'];
  nextStatus: PaymentIntentStatus;
  reasonCode: string;
};

@Injectable()
export class CanonicalPaymentWebhookService {
  static readonly CLAIM_LEASE_MS = 30_000;
  static readonly CLAIM_HEARTBEAT_MS = 10_000;
  static readonly MAX_PROCESSING_ATTEMPTS = 5;

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
    const terminal = this.claimTerminalResult(claim);
    if (terminal) return terminal;
    if (claim.state !== 'CLAIMED') throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_RECOVERY_BLOCKED' });
    if (!claim.webhookId) throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_PERSISTENCE_FAILED' });

    const fallback: ClaimedWebhookEvidence = {
      id: claim.webhookId,
      provider,
      eventId: parsed.eventId,
      providerPaymentId: parsed.providerPaymentId,
      providerReference: parsed.providerReference,
      eventType: parsed.eventType,
      status: parsed.status,
      amount: parsed.amount == null ? null : new Prisma.Decimal(parsed.amount),
      currency: parsed.currency,
      signatureValid: true,
      payloadHash,
      providerAccountHash: accountHash,
      processedStatus: 'PROCESSING',
      transitionApplied: claim.transitionApplied,
      paymentIntent: intent ?? null,
    };
    return this.processClaimedWebhook(claim.webhookId, leaseOwnerHash, fallback);
  }

  async recoverPendingBatch(workerIdentity: string, now = new Date(), limit = 25) {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');
    const ids = await this.repository.findRecoverableWebhookIds(
      now,
      limit,
      CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
    );
    const result = { candidates: ids.length, completed: 0, replayed: 0, active: 0, blocked: 0, failed: 0 };
    for (const webhookId of ids) {
      const leaseOwnerHash = this.hash(`${workerIdentity}:${webhookId}:${randomUUID()}`);
      const claim = await this.repository.claimRecoverableWebhook({
        webhookId,
        leaseOwnerHash,
        leaseExpiresAt: new Date(now.getTime() + CanonicalPaymentWebhookService.CLAIM_LEASE_MS),
        maxAttempts: CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
      });
      if (claim.state === 'ACTIVE') {
        result.active += 1;
        continue;
      }
      if (claim.state === 'BLOCKED' || claim.state === 'IDENTITY_CONFLICT') {
        result.blocked += 1;
        continue;
      }
      if (claim.state === 'REPLAY') {
        result.replayed += 1;
        continue;
      }
      try {
        await this.processClaimedWebhook(claim.webhookId, leaseOwnerHash);
        result.completed += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  private async processClaimedWebhook(
    webhookId: string,
    leaseOwnerHash: string,
    fallback?: ClaimedWebhookEvidence,
  ): Promise<CanonicalWebhookResult> {
    const heartbeat = this.startClaimHeartbeat(webhookId, leaseOwnerHash);
    try {
      const persisted = await this.loadClaimedEvidence(webhookId, leaseOwnerHash, fallback);
      if (!persisted || !persisted.signatureValid || persisted.provider !== PaymentIntentProvider.BOLD) {
        throw new BadRequestException({ code: 'PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID' });
      }
      const intent = persisted.paymentIntent;
      if (!intent) {
        const result: CanonicalWebhookResult = {
          processedStatus: 'REFERENCE_UNKNOWN',
          paymentIntentId: null,
          paymentStatus: null,
        };
        await this.completeClaim(webhookId, leaseOwnerHash, result);
        return result;
      }

      const decision = this.decide(persisted);
      await this.advanceCheckpoint(persisted.processedStatus, webhookId, leaseOwnerHash, 'VALIDATED');

      let updatedStatus = intent.status;
      if (intent.status === decision.nextStatus && persisted.transitionApplied) {
        updatedStatus = intent.status;
      } else if (intent.status === decision.nextStatus) {
        decision.processedStatus = 'DUPLICATE_REPLAY';
      } else {
        const updated = await this.repository.transitionPayment({
          paymentIntentId: intent.id,
          expectedVersion: intent.version,
          toStatus: decision.nextStatus,
          reasonCode: decision.reasonCode,
          idempotencyKey: persisted.eventId
            ? `webhook:${persisted.provider}:${persisted.eventId}`
            : `webhook-hash:${persisted.payloadHash}`,
          webhookEventId: webhookId,
          providerPaymentId: persisted.providerPaymentId,
          providerReference: persisted.providerReference,
          metadata: {
            provider: persisted.provider,
            eventType: persisted.eventType,
            processedStatus: decision.processedStatus,
          },
          webhookClaim: { webhookId, leaseOwnerHash },
        });
        updatedStatus = updated.status;
      }
      await this.advanceCheckpoint(persisted.processedStatus, webhookId, leaseOwnerHash, 'TRANSITION_APPLIED');

      if (updatedStatus === PaymentIntentStatus.SUCCEEDED) {
        await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
        const successes = await this.repository.successfulPaymentCount(intent.checkoutId);
        if (successes > 1) {
          await this.repository.markFinancialReview(intent.checkoutId, 'MULTIPLE_SUCCESSFUL_PAYMENTS');
          decision.processedStatus = 'FINANCIAL_REVIEW_REQUIRED';
        } else {
          await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
          await this.repository.markCheckoutPaymentVerified(intent.checkoutId);
          await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
          await this.kitchen.evaluateAndMark(intent.checkoutId, null);
        }
      }
      await this.advanceCheckpoint(persisted.processedStatus, webhookId, leaseOwnerHash, 'DOWNSTREAM_APPLIED');

      const result: CanonicalWebhookResult = {
        processedStatus: decision.processedStatus,
        paymentIntentId: intent.id,
        paymentStatus: updatedStatus,
      };
      await heartbeat.stopAndAssert();
      await this.completeClaim(webhookId, leaseOwnerHash, result);
      return result;
    } catch (error) {
      heartbeat.stop();
      await this.failClaim(webhookId, leaseOwnerHash, error);
      throw error;
    } finally {
      heartbeat.stop();
    }
  }

  private startClaimHeartbeat(webhookId: string, leaseOwnerHash: string) {
    const recovery = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'renewWebhookClaim'>>;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> | null = null;
    let failure: unknown = null;
    let stopped = false;

    const renew = () => {
      if (stopped || inFlight || failure || typeof recovery.renewWebhookClaim !== 'function') return;
      inFlight = recovery.renewWebhookClaim(webhookId, leaseOwnerHash)
        .then(() => undefined)
        .catch((error: unknown) => {
          failure = error;
        })
        .finally(() => {
          inFlight = null;
        });
    };
    if (typeof recovery.renewWebhookClaim === 'function') {
      timer = setInterval(renew, CanonicalPaymentWebhookService.CLAIM_HEARTBEAT_MS);
      timer.unref();
    }

    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    };
    return {
      stop,
      stopAndAssert: async () => {
        stop();
        if (inFlight) await inFlight;
        if (failure) throw failure;
        await this.repository.assertWebhookClaimOwned(webhookId, leaseOwnerHash);
      },
    };
  }

  private decide(evidence: ClaimedWebhookEvidence): WebhookDecision {
    const intent = evidence.paymentIntent!;
    if (evidence.amount == null || Number(evidence.amount) !== Number(intent.amount)) {
      return {
        processedStatus: 'AMOUNT_MISMATCH',
        nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
        reasonCode: 'BOLD_AMOUNT_MISMATCH',
      };
    }
    if (evidence.currency !== intent.currency) {
      return {
        processedStatus: 'CURRENCY_MISMATCH',
        nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
        reasonCode: 'BOLD_CURRENCY_MISMATCH',
      };
    }
    if (!intent.providerAccountHash || !evidence.providerAccountHash || evidence.providerAccountHash !== intent.providerAccountHash) {
      return {
        processedStatus: 'ACCOUNT_MISMATCH',
        nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
        reasonCode: 'BOLD_ACCOUNT_MISMATCH',
      };
    }
    if (intent.status === PaymentIntentStatus.UNKNOWN_RESULT) {
      return {
        processedStatus: 'FINANCIAL_REVIEW_REQUIRED',
        nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
        reasonCode: 'WEBHOOK_AFTER_UNKNOWN_RESULT_REQUIRES_REVIEW',
      };
    }
    if (evidence.status === 'APPROVED') {
      if (intent.checkout.status === 'CANCELLED' || intent.checkout.status === 'EXPIRED') {
        return {
          processedStatus: 'FINANCIAL_REVIEW_REQUIRED',
          nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
          reasonCode: 'PAYMENT_AFTER_CHECKOUT_TERMINAL',
        };
      }
      return {
        processedStatus: 'PROCESSED',
        nextStatus: PaymentIntentStatus.SUCCEEDED,
        reasonCode: 'BOLD_PAYMENT_VERIFIED',
      };
    }
    if (evidence.status === 'FAILED') {
      return {
        processedStatus: 'PROCESSED',
        nextStatus: PaymentIntentStatus.FAILED,
        reasonCode: 'BOLD_PAYMENT_FAILED',
      };
    }
    if (evidence.status === 'REVIEW') {
      return {
        processedStatus: 'FINANCIAL_REVIEW_REQUIRED',
        nextStatus: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED,
        reasonCode: 'BOLD_PROVIDER_REVIEW',
      };
    }
    return {
      processedStatus: 'PROCESSED',
      nextStatus: PaymentIntentStatus.PENDING,
      reasonCode: 'BOLD_WEBHOOK_PENDING',
    };
  }

  private async loadClaimedEvidence(
    webhookId: string,
    leaseOwnerHash: string,
    fallback?: ClaimedWebhookEvidence,
  ) {
    const loader = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'findClaimedWebhookEvidence'>>;
    if (typeof loader.findClaimedWebhookEvidence === 'function') {
      return loader.findClaimedWebhookEvidence(webhookId, leaseOwnerHash);
    }
    return fallback ?? null;
  }

  private async advanceCheckpoint(
    startingCheckpoint: string,
    webhookId: string,
    leaseOwnerHash: string,
    checkpoint: 'VALIDATED' | 'TRANSITION_APPLIED' | 'DOWNSTREAM_APPLIED',
  ) {
    const rank: Record<string, number> = {
      PROCESSING: 0,
      VALIDATED: 1,
      TRANSITION_APPLIED: 2,
      DOWNSTREAM_APPLIED: 3,
    };
    const targetRank = rank[checkpoint] ?? Number.MAX_SAFE_INTEGER;
    if ((rank[startingCheckpoint] ?? 0) >= targetRank) return;
    const recovery = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'advanceWebhookCheckpoint'>>;
    await recovery.advanceWebhookCheckpoint?.({ webhookId, leaseOwnerHash, checkpoint });
  }

  private claimTerminalResult(claim: WebhookClaim): CanonicalWebhookResult | null {
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
    return null;
  }

  private async claimWebhook(input: WebhookEvidenceInput, leaseOwnerHash: string): Promise<WebhookClaim> {
    const recovery = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'claimWebhookEvidence'>>;
    if (typeof recovery.claimWebhookEvidence !== 'function') {
      if (input.eventId) {
        const replay = await this.repository.findWebhook(input.provider, input.eventId);
        if (replay) {
          return {
            state: 'REPLAY',
            webhookId: replay.id,
            result: {
              processedStatus: 'DUPLICATE_REPLAY',
              paymentIntentId: replay.paymentIntentId,
              paymentStatus: null,
            },
          };
        }
      }
      return {
        state: 'CLAIMED',
        webhookId: null,
        paymentIntentId: input.paymentIntentId ?? null,
        transitionApplied: false,
        attempt: 1,
      };
    }
    return recovery.claimWebhookEvidence({
      ...input,
      leaseOwnerHash,
      leaseExpiresAt: new Date(Date.now() + CanonicalPaymentWebhookService.CLAIM_LEASE_MS),
      maxAttempts: CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
    });
  }

  private async completeClaim(webhookId: string, leaseOwnerHash: string, result: CanonicalWebhookResult) {
    const recovery = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'completeWebhookClaim'>>;
    await recovery.completeWebhookClaim?.({ webhookId, leaseOwnerHash, result });
  }

  private async failClaim(webhookId: string, leaseOwnerHash: string, error: unknown) {
    const recovery = this.repository as Partial<Pick<PrismaOrderCheckoutRepository, 'failWebhookClaim'>>;
    const errorCode = this.errorCode(error);
    await recovery.failWebhookClaim?.({
      webhookId,
      leaseOwnerHash,
      errorCode,
      maxAttempts: CanonicalPaymentWebhookService.MAX_PROCESSING_ATTEMPTS,
      retryable: this.retryable(errorCode),
    });
  }

  private retryable(errorCode: string) {
    return ![
      'PAYMENT_UNKNOWN_RESULT',
      'PAYMENT_WEBHOOK_IDENTITY_CONFLICT',
      'PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID',
      'PAYMENT_WEBHOOK_REFERENCE_NOT_BOUND',
    ].some((code) => errorCode.includes(code));
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
