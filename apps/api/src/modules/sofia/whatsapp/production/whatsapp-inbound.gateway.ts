import { Injectable } from '@nestjs/common';
import type { ParsedWhatsappInbound, WhatsappProviderName } from '../whatsapp-provider.adapter';
import { WhatsappDeliveryStatusService } from './whatsapp-delivery-status.service';
import { WhatsappEventNormalizer } from './whatsapp-event-normalizer';
import { WhatsappInboundDeduplicator } from './whatsapp-inbound-deduplicator';
import { WhatsappProviderHealthService } from './whatsapp-provider-health.service';
import type { ProviderAccountObservation } from './whatsapp-production.types';

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
    const account = await this.health.bind(accountObservation);
    const event = this.normalizer.normalize({ ...input, account: accountObservation });
    const claim = await this.deduplicator.claim(event, account.id);
    if (claim.state === 'DETERMINISTIC_REPLAY') return { event, account, claim, terminal: true, result: claim.replay };
    if (event.kind === 'STATUS_EVENT') {
      const result = await this.statuses.apply({
        accountId: account.id, providerStatusEventId: event.eventId, providerMessageId: event.messageId,
        recipientIdentityHash: event.recipientIdentityHash, status: event.status, occurredAt: event.occurredAt, payloadHash: event.payloadHash,
      });
      const response = { processingStatus: result.duplicate ? 'STATUS_DUPLICATE' : 'STATUS_PROCESSED', status: event.status };
      await this.deduplicator.complete(claim.inboundEventId, response.processingStatus, response);
      return { event, account, claim, terminal: true, result: response };
    }
    if (event.kind === 'UNSUPPORTED_EVENT') {
      const response = { processingStatus: 'UNSUPPORTED_ACKNOWLEDGED', reasonCode: event.reasonCode };
      await this.deduplicator.complete(claim.inboundEventId, response.processingStatus, response);
      return { event, account, claim, terminal: true, result: response };
    }
    return { event, account, claim, terminal: false, result: null };
  }

  complete(inboundEventId: string, processingStatus: string, result: unknown, errorCode?: string | null) {
    return this.deduplicator.complete(inboundEventId, processingStatus, result, errorCode);
  }
}
