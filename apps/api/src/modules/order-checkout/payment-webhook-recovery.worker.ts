import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 25;
const SHUTDOWN_WAIT_MS = 5_000;

@Injectable()
export class PaymentWebhookRecoveryWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentWebhookRecoveryWorker.name);
  private readonly workerIdentity = `${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly webhooks: CanonicalPaymentWebhookService) {}

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

  async runOnce(now = new Date()): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.webhooks
      .recoverPendingBatch(this.workerIdentity, now, DEFAULT_BATCH_SIZE)
      .then(() => undefined)
      .finally(() => {
        if (this.activeCycle === cycle) this.activeCycle = null;
      });
    this.activeCycle = cycle;
    return cycle;
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
    const configured = process.env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED?.trim().toLowerCase();
    return configured === 'true' || configured === '1';
  }

  private errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
    if (error instanceof Error && /^[A-Z0-9_]{1,128}$/.test(error.message)) return error.message;
    return 'PAYMENT_WEBHOOK_RECOVERY_CYCLE_FAILED';
  }
}
