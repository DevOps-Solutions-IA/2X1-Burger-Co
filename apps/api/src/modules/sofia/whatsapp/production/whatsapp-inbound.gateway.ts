import { Injectable } from '@nestjs/common';
import type { ParsedWhatsappInbound, WhatsappProviderName } from '../whatsapp-provider.adapter';
import { WhatsappDeliveryStatusService } from './whatsapp-delivery-status.service';
import { WhatsappEventNormalizer } from './whatsapp-event-normalizer';
import { WhatsappInboundDeduplicator } from './whatsapp-inbound-deduplicator';
import { WhatsappProviderHealthService } from './whatsapp-provider-health.service';
import type { ProviderAccountObservation } from './whatsapp-production.types';
import type { WhatsappInboundClaimContext } from './whatsapp-production.repository';

@Injectable()
export class WhatsappInboundGateway {
  constructor(
    private readonly normalizer: WhatsappEventNormalizer,
    private readonly deduplicator: WhatsappInboundDeduplicator,
    private readonly health: WhatsappProviderHealthService,
    private readonly statuses: WhatsappDeliveryStatusService,
  ) {}

  async receive(input: {
    provider: WhatsappProviderName;
    rawPayload: Record<string, unknown>;
    parsed: ParsedWhatsappInbound;
    account?: ProviderAccountObservation;
  }) {
    const accountObservation = input.account ?? this.health.testObservation(input.provider as ProviderAccountObservation['provider']);
    const event = this.normalizer.normalize({ ...input, account: accountObservation });
    const account = await this.health.bind(event.account);
    const claim = await this.deduplicator.claim(event, account.id);
    if (claim.state === 'DETERMINISTIC_REPLAY') return { event, account, claim, terminal: true, result: claim.replay };
    const now = new Date();
    const senderLimit = this.senderRateLimit();
    const rateLimit = await this.deduplicator.consumeRateLimit({
      accountId: account.id,
      sender: event.kind === 'INBOUND_MESSAGE' ? event.sender : null,
      accountLimit: 300,
      senderLimit,
      windowStartedAt: new Date(Math.floor(now.getTime() / 60_000) * 60_000),
    });
    if (!rateLimit.allowed) {
      const response = {
        processingStatus: 'RATE_LIMITED',
        reasonCode: rateLimit.reasonCode,
        retryAfterMs: 60_000 - (now.getTime() % 60_000),
      };
      await this.deduplicator.complete(claim, response.processingStatus, response, rateLimit.reasonCode);
      return { event, account, claim, terminal: true, result: response };
    }
    if (event.kind === 'STATUS_EVENT') {
      const result = await this.statuses.apply({
        accountId: account.id, providerStatusEventId: event.eventId, providerMessageId: event.messageId,
        recipientIdentityHash: event.recipientIdentityHash, status: event.status, occurredAt: event.occurredAt, payloadHash: event.payloadHash,
      });
      const response = { processingStatus: result.duplicate ? 'STATUS_DUPLICATE' : 'STATUS_PROCESSED', status: event.status };
      await this.deduplicator.complete(claim, response.processingStatus, response);
      return { event, account, claim, terminal: true, result: response };
    }
    if (event.kind === 'UNSUPPORTED_EVENT') {
      const response = { processingStatus: 'UNSUPPORTED_ACKNOWLEDGED', reasonCode: event.reasonCode };
      await this.deduplicator.complete(claim, response.processingStatus, response);
      return { event, account, claim, terminal: true, result: response };
    }
    return { event, account, claim, terminal: false, result: null };
  }

  complete(claim: WhatsappInboundClaimContext, processingStatus: string, result: unknown, errorCode?: string | null) {
    return this.deduplicator.complete(claim, processingStatus, result, errorCode);
  }

  checkpoint(claim: WhatsappInboundClaimContext, checkpoint: unknown) {
    return this.deduplicator.checkpoint(claim, checkpoint);
  }

  renew(claim: WhatsappInboundClaimContext) {
    return this.deduplicator.renew(claim);
  }

  private senderRateLimit() {
    const value = Number(process.env.SOFIA_WHATSAPP_RATE_LIMIT_PER_MINUTE ?? 20);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000) {
      throw new Error('WHATSAPP_RATE_LIMIT_ENV_INVALID');
    }
    return value;
  }
}
