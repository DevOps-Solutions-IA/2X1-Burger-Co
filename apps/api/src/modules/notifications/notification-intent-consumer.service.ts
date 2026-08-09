import { Injectable } from '@nestjs/common';
import type { NotificationIntent } from '@prisma/client';
import {
  NotificationDispatchPolicyPort,
  NotificationSecureCommandPort,
} from './notification-dispatch.ports';
import { NotificationOutboundMaterializer } from './notification-outbound-materializer';
import { NotificationOutboxService, type ReconcileNotificationInput } from './notification-outbox.service';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const COMMAND_TTL_MS = 5 * 60_000;

export type NotificationConsumptionResult = Readonly<{
  notificationIntentId: string;
  state: 'COMMAND_PENDING' | 'SUPPRESSED' | 'RETRY_SCHEDULED' | 'SKIPPED';
  reasonCode: string;
  secureCommandId: string | null;
}>;

@Injectable()
export class NotificationIntentConsumerService {
  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly policy: NotificationDispatchPolicyPort,
    private readonly materializer: NotificationOutboundMaterializer,
    private readonly commands: NotificationSecureCommandPort,
  ) {}

  async drainOnce(workerIdentity: string, now = new Date(), limit = 25) {
    const candidates = await this.outbox.findClaimCandidates(now, limit);
    const results: NotificationConsumptionResult[] = [];
    for (const candidate of candidates) {
      results.push(await this.consume(candidate.id, workerIdentity, now));
    }
    return results;
  }

  async consume(notificationIntentId: string, workerIdentity: string, now = new Date()): Promise<NotificationConsumptionResult> {
    const claim = await this.outbox.claim(notificationIntentId, workerIdentity, now);
    if (claim.state !== 'CLAIMED') {
      return this.result(notificationIntentId, 'SKIPPED', `NOTIFICATION_${claim.state}`, null);
    }

    const intent = claim.intent;
    try {
      const decision = await this.policy.evaluate(intent);
      if (!decision.allowed) {
        await this.suppress(intent, workerIdentity, decision.reasonCode, decision, now);
        return this.result(intent.id, 'SUPPRESSED', decision.reasonCode, null);
      }
      if (this.stalePolicyBinding(intent, decision)) {
        await this.suppress(intent, workerIdentity, 'NOTIFICATION_POLICY_VERSION_STALE', decision, now);
        return this.result(intent.id, 'SUPPRESSED', 'NOTIFICATION_POLICY_VERSION_STALE', null);
      }

      const materialized = await this.materializer.materialize(intent);
      const binding = materialized.binding;
      const command = await this.commands.receive({
        notificationIntentId: intent.id,
        binding,
        expiresAt: this.commandExpiry(intent, now),
      });
      await this.outbox.markCommandPending({
        notificationIntentId: intent.id,
        expectedVersion: intent.version,
        workerIdentity,
        secureCommandId: command.commandId,
        outboundMessageId: binding.outboundMessageId,
        now,
      });
      return this.result(intent.id, 'COMMAND_PENDING', command.replayed ? 'SECURE_COMMAND_REPLAYED' : 'SECURE_COMMAND_CREATED', command.commandId);
    } catch (error) {
      const code = this.errorCode(error);
      if (code === 'SOFIA_COMMAND_POLICY_BLOCKED' || code === 'WHATSAPP_REAL_SEND_DISABLED') {
        await this.suppress(intent, workerIdentity, code, null, now);
        return this.result(intent.id, 'SUPPRESSED', code, null);
      }
      if (code === 'NOTIFICATION_COMMAND_BINDING_INVALID') {
        await this.suppress(intent, workerIdentity, code, null, now);
        return this.result(intent.id, 'SUPPRESSED', code, null);
      }
      await this.outbox.markPreDispatchFailure({
        notificationIntentId: intent.id,
        expectedVersion: intent.version,
        workerIdentity,
        errorCode: code,
        now,
      });
      return this.result(intent.id, 'RETRY_SCHEDULED', code, null);
    }
  }

  reconcile(input: ReconcileNotificationInput) {
    return this.outbox.reconcile(input);
  }

  private suppress(
    intent: NotificationIntent,
    workerIdentity: string,
    reasonCode: string,
    decision: Readonly<{ consentVersion: number | null; handoffVersion: number | null }> | null,
    now: Date,
  ) {
    return this.outbox.markSuppressed({
      notificationIntentId: intent.id,
      expectedVersion: intent.version,
      workerIdentity,
      reasonCode,
      consentVersion: decision?.consentVersion ?? null,
      handoffVersion: decision?.handoffVersion ?? null,
      now,
    });
  }

  private stalePolicyBinding(
    intent: NotificationIntent,
    decision: Readonly<{ consentVersion: number | null; handoffVersion: number | null }>,
  ) {
    return (intent.consentVersion !== null && intent.consentVersion !== decision.consentVersion)
      || (intent.handoffVersion !== null && intent.handoffVersion !== decision.handoffVersion);
  }

  private commandExpiry(intent: NotificationIntent, now: Date) {
    const bounded = new Date(now.getTime() + COMMAND_TTL_MS);
    return intent.expiresAt && intent.expiresAt < bounded ? intent.expiresAt : bounded;
  }

  private errorCode(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
    if (error instanceof Error && SAFE_ID.test(error.message)) return error.message;
    return 'NOTIFICATION_DEPENDENCY_UNAVAILABLE';
  }

  private result(
    notificationIntentId: string,
    state: NotificationConsumptionResult['state'],
    reasonCode: string,
    secureCommandId: string | null,
  ): NotificationConsumptionResult {
    return Object.freeze({ notificationIntentId, state, reasonCode, secureCommandId });
  }
}
