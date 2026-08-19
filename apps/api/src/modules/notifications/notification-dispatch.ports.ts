import { HttpException, Injectable } from '@nestjs/common';
import type { CustomerConsentPurpose, NotificationIntent } from '@prisma/client';
import { SecureCommandError, UnknownCommandResultError } from '../secure-command/secure-command.errors';
import { SecureCommandService } from '../secure-command/secure-command.service';
import { WhatsappMessagePolicyService } from '../sofia/whatsapp/production/whatsapp-message-policy.service';
import type { NotificationReconciliationObservation } from './domain/notification.types';

export type NotificationDispatchPolicyDecision = Readonly<{
  allowed: boolean;
  reasonCode: string;
  consentVersion: number | null;
  handoffVersion: number | null;
}>;

export type NotificationCommandBinding = Readonly<{
  outboundMessageId: string;
  conversationId: string;
  recipientIdentityHash: string;
  purpose: CustomerConsentPurpose;
  bodyHash: string;
  accountId: string;
  expectedConversationVersion: number;
}>;

export type ReceiveNotificationCommandInput = Readonly<{
  notificationIntentId: string;
  binding: NotificationCommandBinding;
  expiresAt: Date;
}>;

export abstract class NotificationDispatchPolicyPort {
  abstract evaluate(intent: NotificationIntent): Promise<NotificationDispatchPolicyDecision>;
}

export abstract class NotificationSecureCommandPort {
  abstract receive(input: ReceiveNotificationCommandInput): Promise<Readonly<{
    commandId: string;
    replayed: boolean;
  }>>;
}

@Injectable()
export class WhatsappNotificationDispatchPolicyAdapter extends NotificationDispatchPolicyPort {
  constructor(private readonly policy: WhatsappMessagePolicyService) {
    super();
  }

  async evaluate(intent: NotificationIntent): Promise<NotificationDispatchPolicyDecision> {
    if (intent.channel !== 'WHATSAPP') {
      return this.blocked('NOTIFICATION_CHANNEL_UNSUPPORTED');
    }
    if (!intent.conversationId) {
      return this.blocked('NOTIFICATION_CONVERSATION_REQUIRED');
    }

    try {
      const decision = await this.policy.outbound(
        intent.conversationId,
        intent.customerId,
        intent.purpose === 'MARKETING' ? 'MARKETING' : 'SERVICE',
      );
      return Object.freeze({
        allowed: true,
        reasonCode: 'NOTIFICATION_POLICY_ALLOWED',
        consentVersion: decision.consent.version,
        handoffVersion: decision.handoff.version,
      });
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const response = error.getResponse();
      const code = typeof response === 'object' && response !== null && 'code' in response
        ? String(response.code)
        : 'NOTIFICATION_POLICY_BLOCKED';
      return this.blocked(code);
    }
  }

  private blocked(reasonCode: string): NotificationDispatchPolicyDecision {
    return Object.freeze({ allowed: false, reasonCode, consentVersion: null, handoffVersion: null });
  }
}

@Injectable()
export class SecureCommandNotificationAdapter extends NotificationSecureCommandPort {
  constructor(private readonly commands: SecureCommandService) {
    super();
  }

  async receive(input: ReceiveNotificationCommandInput) {
    const view = await this.commands.receive({
      commandType: 'SOFIA_SEND_WHATSAPP',
      idempotencyKey: `notification:${input.notificationIntentId}`,
      target: {
        type: 'WhatsappOutboundMessage',
        id: input.binding.outboundMessageId,
        expectedVersion: String(input.binding.expectedConversationVersion),
      },
      payload: {
        outboundMessageId: input.binding.outboundMessageId,
        conversationId: input.binding.conversationId,
        recipientIdentityHash: input.binding.recipientIdentityHash,
        purpose: input.binding.purpose,
        bodyHash: input.binding.bodyHash,
        accountId: input.binding.accountId,
      },
      expiresAt: input.expiresAt,
      actor: {
        actorId: 'notification-outbox',
        actorType: 'SYSTEM',
        roles: ['system'],
      },
      source: 'notification_outbox',
      scope: 'whatsapp_notification',
    });
    return Object.freeze({ commandId: view.command.id, replayed: view.replayed });
  }
}

/**
 * Closes the previously-missing NotificationIntent -> Outbox -> SecureCommand.receive() -> execute()
 * gap: this is the only call site in the notifications module that ever invokes
 * SecureCommandService.execute(). It is intentionally a separate port/adapter from
 * NotificationSecureCommandPort (which only ever calls receive()) so the receive-time binding
 * guarantees already covered by SecureCommandNotificationAdapter's tests stay untouched.
 *
 * This adapter never talks to the WhatsApp provider directly and never bypasses SecureCommand
 * authority -- it only translates SecureCommandService.execute()'s outcome (success, a durable
 * policy/approval block, an already-running claim, or an UnknownCommandResultError) into the
 * NotificationReconciliationObservation vocabulary the outbox already uses, so
 * NotificationCommandExecutionService can persist the result through the existing, audited
 * NotificationOutboxService.markDispatched()/reconcile() transitions. While SOFIA_SEND_WHATSAPP
 * stays `enabled: false` (command-handler.registry.ts, TEAM I exclusive, untouched here),
 * SecureCommandService.execute() deterministically throws SOFIA_COMMAND_APPROVAL_REQUIRED before
 * ever claiming the command or invoking WhatsappOutboundCommandHandler -- so calling this adapter
 * can never cause a real WhatsApp transmission.
 */
export type ExecuteNotificationCommandInput = Readonly<{
  notificationIntentId: string;
  secureCommandId: string;
}>;

export type NotificationCommandExecutionOutcome =
  | Readonly<{ status: 'DISPATCHED'; replayed: boolean }>
  | Readonly<{ status: 'RUNNING' }>
  | Readonly<{
      status: 'BLOCKED';
      observation: Extract<NotificationReconciliationObservation, 'COMMAND_REJECTED' | 'RESULT_UNKNOWN'>;
      errorCode: string;
    }>;

export abstract class NotificationCommandExecutionPort {
  abstract execute(input: ExecuteNotificationCommandInput): Promise<NotificationCommandExecutionOutcome>;
}

@Injectable()
export class SecureCommandExecutionAdapter extends NotificationCommandExecutionPort {
  constructor(private readonly commands: SecureCommandService) {
    super();
  }

  async execute(input: ExecuteNotificationCommandInput): Promise<NotificationCommandExecutionOutcome> {
    try {
      const executed = await this.commands.execute({
        commandId: input.secureCommandId,
        actor: { actorId: 'notification-outbox', actorType: 'SYSTEM', roles: ['system'] },
        claimOwner: `notification-dispatch:${input.notificationIntentId}`,
      });
      return Object.freeze({ status: 'DISPATCHED' as const, replayed: executed.replayed });
    } catch (error) {
      if (error instanceof UnknownCommandResultError) {
        return Object.freeze({ status: 'BLOCKED' as const, observation: 'RESULT_UNKNOWN' as const, errorCode: error.code });
      }
      if (error instanceof SecureCommandError) {
        if (error.code === 'SOFIA_COMMAND_ALREADY_RUNNING') {
          return Object.freeze({ status: 'RUNNING' as const });
        }
        if (error.code === 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE') {
          return Object.freeze({ status: 'BLOCKED' as const, observation: 'RESULT_UNKNOWN' as const, errorCode: error.code });
        }
        return Object.freeze({ status: 'BLOCKED' as const, observation: 'COMMAND_REJECTED' as const, errorCode: error.code });
      }
      throw error;
    }
  }
}
