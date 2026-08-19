import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PaymentIntentStatus } from '@prisma/client';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 50;
const SHUTDOWN_WAIT_MS = 5_000;

const ACTIVE_INTENT_STATUSES: readonly PaymentIntentStatus[] = [
  PaymentIntentStatus.CREATED,
  PaymentIntentStatus.LINK_READY,
  PaymentIntentStatus.PENDING,
];

export type PaymentExpirationCycleResult = {
  intentsExpired: number;
  linksExpired: number;
  checkoutsExpired: number;
};

/**
 * PK4 (Recovery / Expiration), SOFIA Wave 2B.
 *
 * Sweeps three independent TTL surfaces that already exist on the schema (`expiresAt` on
 * PaymentIntent, PaymentLink, and OrderCheckout -- no migration required) and were previously never
 * actively transitioned by anything: a candidate row could sit forever with a past `expiresAt` and a
 * non-terminal `status`. This worker is the first thing that ever flips them.
 *
 * Order within a cycle matters:
 *   1. PaymentIntent sweep -- CREATED/LINK_READY/PENDING past TTL -> EXPIRED, via the existing
 *      version-guarded `transitionPayment` (same path a webhook transition uses), so this can never
 *      race a concurrent webhook: whichever wins the row lock / version check first is authoritative,
 *      the loser's transitionPayment call throws PAYMENT_INTENT_CONFLICT and is skipped here (logged,
 *      not fatal -- something else already resolved that intent, which is the correct outcome).
 *   2. PaymentLink sweep -- pure housekeeping status flip (never consulted by any financial
 *      decision; the actual gate is always the read-time `expiresAt` comparison already used by
 *      findActivePaymentLink / resolvePaymentLink), safe as an unversioned bulk update.
 *   3. OrderCheckout sweep -- PAYMENT_PENDING past its own (independent) deadline -> EXPIRED, via the
 *      same lock-then-conditional-update pattern as markKitchenEligible. Run last and, for each
 *      checkout actually flipped, cascades into expiring its still-open latest PaymentIntent (if any)
 *      -- a checkout can legitimately expire before its most recent intent's own (shorter) TTL, and a
 *      still-active PaymentLink must never remain payable against an already-terminal checkout.
 *
 * Never resolves UNKNOWN_RESULT or FINANCIAL_REVIEW_REQUIRED -- both are excluded from the active-set
 * this worker touches, by construction (assertPaymentTransition only allows EXPIRED as a target from
 * CREATED/LINK_READY/PENDING). Never blindly retries a provider call -- this worker only ever writes
 * a terminal EXPIRED status locally; it never talks to Bold.
 *
 * Gated behind the same Phase5RuntimeGate('PAYMENT_ORCHESTRATION') capability that
 * CanonicalPaymentWebhookService.recoverPendingBatch already uses, so kill switch / global pause /
 * production-forbidden / capability-disabled all apply identically to this worker.
 */
@Injectable()
export class PaymentExpirationWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentExpirationWorker.name);
  private readonly workerIdentity = `${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<PaymentExpirationCycleResult> | null = null;
  private stopping = false;

  constructor(
    private readonly repository: PrismaOrderCheckoutRepository,
    private readonly gate: Phase5RuntimeGate,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) return;
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.activeCycle) return;
    await Promise.race([
      this.activeCycle.catch(() => undefined),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timeout.unref();
      }),
    ]);
  }

  async runOnce(now = new Date()): Promise<PaymentExpirationCycleResult> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.cycle(now).finally(() => {
      if (this.activeCycle === cycle) this.activeCycle = null;
    });
    this.activeCycle = cycle;
    return cycle;
  }

  private async cycle(now: Date): Promise<PaymentExpirationCycleResult> {
    await this.gate.assertEnabled('PAYMENT_ORCHESTRATION');

    const intentIds = await this.repository.findExpirablePaymentIntentIds(now, DEFAULT_BATCH_SIZE);
    let intentsExpired = 0;
    for (const id of intentIds) {
      if (await this.expireOneIntent(id)) intentsExpired += 1;
    }

    const linksExpired = await this.repository.expireStalePaymentLinks(now, DEFAULT_BATCH_SIZE);

    const checkoutIds = await this.repository.findExpirableCheckoutIds(now, DEFAULT_BATCH_SIZE);
    let checkoutsExpired = 0;
    for (const id of checkoutIds) {
      const outcome = await this.expireOneCheckout(id);
      if (outcome.checkoutExpired) checkoutsExpired += 1;
      if (outcome.cascadedIntentExpired) intentsExpired += 1;
    }

    return { intentsExpired, linksExpired, checkoutsExpired };
  }

  private async expireOneIntent(paymentIntentId: string): Promise<boolean> {
    try {
      const intent = await this.repository.findPaymentIntent(paymentIntentId);
      if (!ACTIVE_INTENT_STATUSES.includes(intent.status)) return false;
      await this.repository.transitionPayment({
        paymentIntentId: intent.id,
        expectedVersion: intent.version,
        toStatus: PaymentIntentStatus.EXPIRED,
        reasonCode: 'PAYMENT_INTENT_TTL_ELAPSED',
        idempotencyKey: `${intent.id}:expired`,
      });
      return true;
    } catch (error) {
      this.logger.warn(`payment intent ${paymentIntentId} expiration skipped: ${this.errorCode(error)}`);
      return false;
    }
  }

  private async expireOneCheckout(checkoutId: string): Promise<{ checkoutExpired: boolean; cascadedIntentExpired: boolean }> {
    try {
      await this.repository.expireCheckoutPaymentPending(checkoutId);
    } catch (error) {
      this.logger.warn(`checkout ${checkoutId} expiration skipped: ${this.errorCode(error)}`);
      return { checkoutExpired: false, cascadedIntentExpired: false };
    }
    // Cascade: a checkout can expire before its latest PaymentIntent's own (independent) TTL --
    // never leave a still-open, still-payable PaymentLink pointing at a checkout that is now
    // terminal. Best-effort: if the intent already resolved by other means (webhook race), this is
    // a harmless no-op via expireOneIntent's own status re-check.
    const checkout = await this.repository.findCheckout(checkoutId);
    const latest = checkout?.paymentIntents[0];
    const cascadedIntentExpired =
      latest && ACTIVE_INTENT_STATUSES.includes(latest.status) ? await this.expireOneIntent(latest.id) : false;
    return { checkoutExpired: true, cascadedIntentExpired };
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce()
        .catch((error: unknown) => this.logger.error(this.errorCode(error)))
        .finally(() => this.schedule(DEFAULT_INTERVAL_MS));
    }, delayMs);
    this.timer.unref();
  }

  private enabled(): boolean {
    const configured = process.env.PAYMENT_EXPIRATION_WORKER_ENABLED?.trim().toLowerCase();
    return configured === 'true' || configured === '1';
  }

  private errorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const response = 'response' in error ? (error as { response?: unknown }).response : null;
      if (response && typeof response === 'object' && 'code' in response && typeof (response as { code?: unknown }).code === 'string') {
        return (response as { code: string }).code;
      }
      if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
        return (error as { code: string }).code;
      }
    }
    if (error instanceof Error && /^[A-Z0-9_]{1,128}$/.test(error.message)) return error.message;
    return 'PAYMENT_EXPIRATION_CYCLE_FAILED';
  }

  /** Present for parity with PaymentWebhookRecoveryWorker; identifies this worker instance in logs. */
  get identity(): string {
    return this.workerIdentity;
  }
}
