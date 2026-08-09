import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaWhatsappConversationRepository } from './persistence/prisma-whatsapp-conversation.repository';
import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';
import { WhatsappHandoffService } from './whatsapp-handoff.service';

const RECOVERY_INTERVAL_MS = 2_000;
const RECOVERY_BATCH_SIZE = 25;
const SHUTDOWN_WAIT_MS = 5_000;

@Injectable()
export class WhatsappInboundRecoveryWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappInboundRecoveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly repository: PrismaWhatsappProductionRepository,
    private readonly conversations: PrismaWhatsappConversationRepository,
    private readonly handoff: WhatsappHandoffService,
  ) {}

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

  async runOnce(now = new Date()): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const cycle = this.recover(now).finally(() => {
      if (this.activeCycle === cycle) this.activeCycle = null;
    });
    this.activeCycle = cycle;
    return cycle;
  }

  private async recover(now: Date): Promise<void> {
    const candidates = await this.repository.recoverAbandonedInboundBatch(now, RECOVERY_BATCH_SIZE);
    for (const candidate of candidates) {
      try {
        const conversation = await this.conversations.findLatestConversationByProviderPhone(
          candidate.provider,
          candidate.phone,
        );
        if (!conversation) {
          await this.repository.completeAbandonedInboundHandoff(
            candidate.id,
            'CONVERSATION_NOT_FOUND',
          );
          continue;
        }
        const actorId = await this.conversations.inboundRecoveryActorId();
        await this.handoff.transition({
          conversationId: conversation.id,
          actorId,
          actorType: 'SYSTEM',
          target: 'HUMAN_REQUIRED',
          reasonCode: 'WHATSAPP_INBOUND_WORKER_DIED',
          expectedVersion: conversation.handoffVersion,
        });
        await this.repository.completeAbandonedInboundHandoff(candidate.id, 'HUMAN_REQUIRED');
      } catch {
        this.logger.error('WHATSAPP_INBOUND_ABANDONED_HANDOFF_FAILED');
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce()
        .catch(() => this.logger.error('WHATSAPP_INBOUND_RECOVERY_CYCLE_FAILED'))
        .finally(() => this.schedule(RECOVERY_INTERVAL_MS));
    }, delayMs);
    this.timer.unref();
  }
}
