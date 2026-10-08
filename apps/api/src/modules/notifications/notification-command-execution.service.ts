import { Injectable } from '@nestjs/common';
import { NotificationIntentStatus } from '@prisma/client';
import { NotificationCommandExecutionPort } from './notification-dispatch.ports';
import { NotificationOutboxService } from './notification-outbox.service';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

const STALE_VERSION = 'STALE_NOTIFICATION_INTENT_VERSION';

export type NotificationDispatchResult = Readonly<{
  notificationIntentId: string;
  state: 'DISPATCHED' | 'FAILED' | 'UNKNOWN_RESULT' | 'SKIPPED';
  reasonCode: string;
}>;

/**
 * The dispatch stage of the notification outbox: the only place in this module that turns a
 * COMMAND_PENDING NotificationIntent (SecureCommand already received) into an actual
 * SecureCommandService.execute() attempt. Runs after NotificationIntentConsumerService.consume()
 * (which only ever calls receive()) and independently of the existing reconciliation observer
 * (which only ever reads already-settled DB state -- it never itself calls execute()).
 *
 * Fail-closed by construction:
 * - every terminal transition is applied through NotificationOutboxService's existing, audited
 *   markDispatched()/reconcile() methods -- no new state-mutation path is introduced;
 * - an optimistic-concurrency conflict on that transition (another worker already handled this
 *   exact intent version -- duplicate worker claim) is treated as a benign lost race, not an
 *   error, and never retried blindly;
 * - a concurrently-running SecureCommand claim is skipped, never retried blindly;
 * - zero WhatsApp provider access ever happens here -- see SecureCommandExecutionAdapter, which
 *   is the only thing this service talks to on the SecureCommand side.
 */
@Injectable()
export class NotificationCommandExecutionService {
  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly execution: NotificationCommandExecutionPort,
  ) {}

  async dispatch(candidate: NotificationReconciliationCandidate, now = new Date()): Promise<NotificationDispatchResult> {
    if (candidate.status !== NotificationIntentStatus.COMMAND_PENDING || !candidate.secureCommandId || !candidate.outboundMessageId) {
      return this.result(candidate.id, 'SKIPPED', 'NOTIFICATION_DISPATCH_NOT_APPLICABLE');
    }
    const outboundMessageId = candidate.outboundMessageId;
    const secureCommandId = candidate.secureCommandId;

    const outcome = await this.execution.execute({
      notificationIntentId: candidate.id,
      secureCommandId,
    });

    if (outcome.status === 'RUNNING') {
      return this.result(candidate.id, 'SKIPPED', 'SOFIA_COMMAND_ALREADY_RUNNING');
    }

    try {
      if (outcome.status === 'DISPATCHED') {
        await this.outbox.markDispatched({
          notificationIntentId: candidate.id,
          expectedVersion: candidate.version,
          outboundMessageId,
        });
        return this.result(
          candidate.id,
          'DISPATCHED',
          outcome.replayed ? 'SECURE_COMMAND_RESULT_REPLAYED' : 'SECURE_COMMAND_EXECUTED',
        );
      }

      // outcome.status === 'BLOCKED': the SecureCommand execute() attempt was made and
      // deterministically prevented (policy/approval/runtime-safety) or left the result
      // genuinely unknown (dependency failure, lease-recovery, provider unknown-result).
      await this.outbox.reconcile({
        notificationIntentId: candidate.id,
        expectedVersion: candidate.version,
        currentStatus: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId,
        outboundMessageId,
        observation: outcome.observation,
        errorCode: outcome.errorCode,
        now,
      });
      return this.result(
        candidate.id,
        outcome.observation === 'RESULT_UNKNOWN' ? 'UNKNOWN_RESULT' : 'FAILED',
        outcome.errorCode,
      );
    } catch (error) {
      if (this.errorCode(error) === STALE_VERSION) {
        return this.result(candidate.id, 'SKIPPED', 'NOTIFICATION_VERSION_CONFLICT');
      }
      throw error;
    }
  }

  private errorCode(error: unknown): string | null {
    if (error instanceof Error) return error.message;
    return null;
  }

  private result(
    notificationIntentId: string,
    state: NotificationDispatchResult['state'],
    reasonCode: string,
  ): NotificationDispatchResult {
    return Object.freeze({ notificationIntentId, state, reasonCode });
  }
}
