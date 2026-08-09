import { HttpException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { CustomerConsentPurpose, NotificationIntent } from '@prisma/client';
import { SecureCommandService } from '../secure-command/secure-command.service';
import { WhatsappMessagePolicyService } from '../sofia/whatsapp/production/whatsapp-message-policy.service';

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
  constructor(private readonly modules: ModuleRef) {
    super();
  }

  async evaluate(intent: NotificationIntent): Promise<NotificationDispatchPolicyDecision> {
    if (intent.channel !== 'WHATSAPP') {
      return this.blocked('NOTIFICATION_CHANNEL_UNSUPPORTED');
    }
    if (!intent.conversationId) {
      return this.blocked('NOTIFICATION_CONVERSATION_REQUIRED');
    }

    const policy = this.modules.get(WhatsappMessagePolicyService, { strict: false });
    try {
      const decision = await policy.outbound(
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
  constructor(private readonly modules: ModuleRef) {
    super();
  }

  async receive(input: ReceiveNotificationCommandInput) {
    const commands = this.modules.get(SecureCommandService, { strict: false });
    const view = await commands.receive({
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
