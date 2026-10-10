import { Injectable } from '@nestjs/common';
import { NotificationIntentStatus } from '@prisma/client';
import { NotificationCommandExecutionPort } from './notification-dispatch.ports';
import { NotificationOutboxService } from './notification-outbox.service';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

const STALE_VERSION = 'STALE_NOTIFICATION_INTENT_VERSION';

export type NotificationDispatchResult = Readonly<{
  notificationIntentId: string;
  state: 'DISPATCHED' | 'DEFERRED' | 'FAILED' | 'UNKNOWN_RESULT' | 'SKIPPED';
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
 * - every transition is applied through NotificationOutboxService's existing, audited
 *   markDispatched()/reconcile() methods -- no new state-mutation path is introduced;
 * - an unresolved outcome (the command is still inside its real human-approval window, or
 *   another worker/process is concurrently claiming the exact same SecureCommand) is DEFERRED,
 *   never written as a terminal failure: reconcile() routes a 'COMMAND_PENDING' observation
 *   through NotificationOutboxService's existing DEFER branch, which increments attempts and
 *   sets nextRetryAt exactly like the pre-dispatch reconciliation observer always did for any
 *   unresolved COMMAND_PENDING intent -- so the same bounded attempts/maintenance-sweep
 *   settlement (eventually UNKNOWN_RESULT once maxAttempts is reached) still governs how long we
 *   keep waiting, instead of either a premature terminal write or an unbounded 1-second hot loop;
 * - an optimistic-concurrency conflict on that transition (another worker already handled this
 *   exact intent version -- duplicate worker claim) is treated as a benign lost race, not an
 *   error, and never retried blindly;
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

      // RUNNING (a concurrent worker/process is mid-claim on this exact SecureCommand) is just
      // as unresolved as a COMMAND_PENDING/DEFER outcome below -- it must consume the same
      // bounded attempts counter, never a bare skip, or a long-lived concurrent lease turns
      // every subsequent 1-second worker cycle into a blind, unbounded retry against this
      // candidate.
      const observation = outcome.status === 'RUNNING' ? 'COMMAND_PENDING' : outcome.observation;
      const errorCode = outcome.status === 'RUNNING' ? 'SOFIA_COMMAND_ALREADY_RUNNING' : outcome.errorCode;

      // outcome.status === 'RUNNING' or 'BLOCKED': the SecureCommand execute() attempt was
      // made and either left genuinely unresolved (still-open approval window, concurrent
      // claim), deterministically prevented (durable policy/approval block), or left the result
      // genuinely unknown (dependency failure, lease-recovery, provider unknown-result, or an
      // ambiguous post-handler conflict). reconcile() itself decides DEFER vs a terminal
      // transition based on `observation` -- see NotificationOutboxService.reconcile().
      await this.outbox.reconcile({
        notificationIntentId: candidate.id,
        expectedVersion: candidate.version,
        currentStatus: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId,
        outboundMessageId,
        observation,
        errorCode,
        now,
      });
      if (observation === 'COMMAND_PENDING') {
        return this.result(candidate.id, 'DEFERRED', errorCode);
      }
      return this.result(
        candidate.id,
        observation === 'RESULT_UNKNOWN' ? 'UNKNOWN_RESULT' : 'FAILED',
        errorCode,
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
