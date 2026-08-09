import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { OrdersService } from './orders.service';

const RECONCILIATION_INTERVAL_MS = 2_000;
const RECONCILIATION_BATCH_SIZE = 25;
const SHUTDOWN_WAIT_MS = 5_000;

@Injectable()
export class DeliveryWorkflowConsequenceWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryWorkflowConsequenceWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly orders: OrdersService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
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

  async runOnce(): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.orders
      .reconcilePendingDeliveryWorkflowConsequences(RECONCILIATION_BATCH_SIZE)
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
        .catch(() => this.logger.error('DELIVERY_WORKFLOW_CONSEQUENCE_RECOVERY_FAILED'))
        .finally(() => this.schedule(RECONCILIATION_INTERVAL_MS));
    }, delayMs);
    this.timer.unref();
  }
}
