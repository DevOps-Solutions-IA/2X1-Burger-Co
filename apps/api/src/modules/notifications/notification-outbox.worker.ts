import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { NotificationCommandExecutionService } from './notification-command-execution.service';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationReconciliationObserver } from './notification-reconciliation-observer';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 25;
const SHUTDOWN_WAIT_MS = 5_000;

@Injectable()
export class NotificationOutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private readonly workerIdentity = `${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly consumer: NotificationIntentConsumerService,
    private readonly outbox: NotificationOutboxService,
    private readonly observer: NotificationReconciliationObserver,
    private readonly executor: NotificationCommandExecutionService,
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

  async runOnce(now = new Date()): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.executeCycle(now).finally(() => {
      if (this.activeCycle === cycle) this.activeCycle = null;
    });
    this.activeCycle = cycle;
    return cycle;
  }

  private async executeCycle(now: Date): Promise<void> {
    await this.runStage('NOTIFICATION_CLAIM_STAGE_FAILED', () =>
      this.consumer.drainOnce(this.workerIdentity, now, DEFAULT_BATCH_SIZE));

    // Fetched once and partitioned below so the dispatch stage (which actually invokes
    // SecureCommandService.execute() via NotificationCommandExecutionService, for
    // COMMAND_PENDING intents) and the reconciliation stage (which only ever reads
    // already-settled DISPATCHED/UNKNOWN_RESULT evidence -- it never itself calls execute())
    // act on one consistent snapshot instead of two independently-racing queries.
    const candidates = await this.runStageValue(
      'NOTIFICATION_RECONCILIATION_CANDIDATES_FAILED',
      () => this.outbox.findReconciliationCandidates(now, DEFAULT_BATCH_SIZE, false),
      [] as readonly NotificationReconciliationCandidate[],
    );

    await this.runStage('NOTIFICATION_DISPATCH_STAGE_FAILED', async () => {
      for (const candidate of candidates) {
        if (candidate.status !== 'COMMAND_PENDING' || !candidate.secureCommandId) continue;
        await this.runStage('NOTIFICATION_DISPATCH_CANDIDATE_FAILED', () => this.executor.dispatch(candidate, now));
      }
    });

    await this.runStage('NOTIFICATION_RECONCILIATION_STAGE_FAILED', async () => {
      for (const candidate of candidates) {
        if (!candidate.secureCommandId || candidate.status === 'COMMAND_PENDING') continue;
        await this.runStage('NOTIFICATION_RECONCILIATION_CANDIDATE_FAILED', async () => {
          const evidence = await this.observer.observe(candidate);
          await this.consumer.reconcile({
            notificationIntentId: candidate.id,
            expectedVersion: candidate.version,
            currentStatus: candidate.status,
            secureCommandId: candidate.secureCommandId as string,
            outboundMessageId: candidate.outboundMessageId,
            observation: evidence.observation,
            errorCode: evidence.errorCode,
            now,
          });
        });
      }
    });
    await this.runStage('NOTIFICATION_MAINTENANCE_STAGE_FAILED', () =>
      this.outbox.sweepMaintenance(now, DEFAULT_BATCH_SIZE));
  }

  private async runStage(code: string, operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch {
      this.logger.error(code);
    }
  }

  private async runStageValue<T>(code: string, operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch {
      this.logger.error(code);
      return fallback;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce().catch((error: unknown) => {
        this.logger.error(this.errorCode(error));
      }).finally(() => this.schedule(DEFAULT_INTERVAL_MS));
    }, delayMs);
    this.timer.unref();
  }

  private enabled(): boolean {
    return this.config.get<boolean>('NOTIFICATION_OUTBOX_WORKER_ENABLED') === true;
  }

  private errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
    if (error instanceof Error && /^[A-Z0-9_]{1,128}$/.test(error.message)) return error.message;
    return 'NOTIFICATION_WORKER_CYCLE_FAILED';
  }
}
