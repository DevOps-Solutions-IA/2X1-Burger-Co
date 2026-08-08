import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { CommandHandlerResult, CommandRecord } from '../../../secure-command/secure-command.types';
import { WhatsappMessagePolicyService } from './whatsapp-message-policy.service';
import { WhatsappOutboundGateway } from './whatsapp-outbound.gateway';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

@Injectable()
export class WhatsappOutboundCommandHandler {
  constructor(
    private readonly config: ConfigService,
    @Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository,
    private readonly policy: WhatsappMessagePolicyService,
    private readonly gateway: WhatsappOutboundGateway,
  ) {}

  async execute(command: CommandRecord): Promise<CommandHandlerResult> {
    if (command.commandType !== 'SOFIA_SEND_WHATSAPP' || this.config.get<boolean>('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED') !== true) {
      throw new ForbiddenException({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    }
    const outboundId = command.targetId;
    if (!outboundId) throw new NotFoundException({ code: 'WHATSAPP_OUTBOUND_NOT_FOUND' });
    const outbound = await this.repository.outboundForCommand(command.id, outboundId);
    if (!outbound || !outbound.accountId || !outbound.recipientIdentityHash || !outbound.purpose) {
      throw new NotFoundException({ code: 'WHATSAPP_OUTBOUND_BINDING_INVALID' });
    }
    if (command.expectedVersion !== String(outbound.conversation.handoffVersion)) {
      throw new ForbiddenException({ code: 'WHATSAPP_CONVERSATION_VERSION_CONFLICT' });
    }
    const recipientIdentityHash = createHash('sha256').update(outbound.conversation.phone).digest('hex');
    if (recipientIdentityHash !== outbound.recipientIdentityHash) {
      throw new ForbiddenException({ code: 'WHATSAPP_RECIPIENT_BINDING_INVALID' });
    }
    const expectedPayloadHash = this.hashCanonical({
      outboundMessageId: outbound.id,
      conversationId: outbound.conversationId,
      recipientIdentityHash: outbound.recipientIdentityHash,
      purpose: outbound.purpose,
      bodyHash: createHash('sha256').update(outbound.body).digest('hex'),
      accountId: outbound.accountId,
    });
    if (command.payloadHash !== expectedPayloadHash) {
      throw new ForbiddenException({ code: 'WHATSAPP_PAYLOAD_BINDING_INVALID' });
    }
    await this.policy.outbound(outbound.conversationId, outbound.conversation.customerId, outbound.purpose === 'MARKETING' ? 'MARKETING' : 'SERVICE');
    await this.repository.bindOutboundCommand(outbound.id, command.id);
    const provider = this.config.get<string>('WHATSAPP_PROVIDER');
    if (provider !== 'qr_gateway' && provider !== 'hermes') throw new ForbiddenException({ code: 'WHATSAPP_PROVIDER_UNAVAILABLE' });
    if (!outbound.account || outbound.account.provider !== provider || outbound.account.status !== 'VERIFIED_RECEIVE_ONLY') {
      throw new ForbiddenException({ code: 'WHATSAPP_PROVIDER_ACCOUNT_MISMATCH' });
    }
    const result = await this.gateway.send({ provider, to: outbound.conversation.phone, body: outbound.body, mediaUrl: outbound.mediaUrl, idempotencyKey: outbound.idempotencyKey });
    await this.repository.completeOutbound({
      outboundMessageId: outbound.id,
      status: result.code === 'WHATSAPP_SENT' ? 'SENT' : result.unknownResult ? 'UNKNOWN_RESULT' : 'FAILED',
      providerMessageId: result.providerMessageId,
      unknownResult: result.unknownResult,
      sanitizedPayload: { code: result.code, acceptedAt: result.acceptedAt?.toISOString() ?? null },
      errorCode: result.code === 'WHATSAPP_SENT' ? null : result.code,
    });
    return { resultCode: result.code, payload: { outboundMessageId: outbound.id, providerMessageId: result.providerMessageId, unknownResult: result.unknownResult }, domainReferenceIds: [outbound.id] };
  }

  private hashCanonical(value: Record<string, unknown>) {
    const canonical = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
