import { Inject, Injectable } from '@nestjs/common';
import { WhatsappInboundEventKind } from '@prisma/client';
import type { NormalizedWhatsappEvent } from './whatsapp-production.types';
import {
  WHATSAPP_PRODUCTION_REPOSITORY,
  type WhatsappInboundClaimContext,
  type WhatsappProductionRepository,
} from './whatsapp-production.repository';

@Injectable()
export class WhatsappInboundDeduplicator {
  constructor(@Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository) {}

  async claim(event: NormalizedWhatsappEvent, accountId: string) {
    const claimed = await this.repository.claimInbound({
      accountId,
      provider: event.provider,
      eventId: event.eventId,
      messageId: event.kind === 'UNSUPPORTED_EVENT' ? null : event.messageId,
      phone: event.kind === 'INBOUND_MESSAGE' ? event.sender : 'SYSTEM',
      eventHash: event.payloadHash,
      normalizedPayloadHash: event.payloadHash,
      eventKind: WhatsappInboundEventKind[event.kind],
    });
    if (claimed.disposition === 'ACQUIRED' || (claimed.disposition === undefined && claimed.created)) {
      if (!claimed.claimToken || !claimed.leaseExpiresAt) throw new Error('WHATSAPP_INBOUND_CLAIM_CONTEXT_INVALID');
      return Object.freeze({
        state: 'CLAIMED' as const,
        inboundEventId: claimed.id,
        claimToken: claimed.claimToken,
        attempt: claimed.attempt ?? 1,
        leaseExpiresAt: claimed.leaseExpiresAt,
        replay: null,
      });
    }
    return Object.freeze({
      state: 'DETERMINISTIC_REPLAY' as const,
      inboundEventId: claimed.id,
      replay: claimed.deterministicResult ?? {
        processingStatus: claimed.disposition === 'IN_PROGRESS' ? 'PROCESSING' : claimed.processingStatus,
      },
    });
  }

  complete(claim: WhatsappInboundClaimContext, processingStatus: string, result: unknown, errorCode?: string | null) {
    return this.repository.completeInbound(
      claim.inboundEventId,
      processingStatus,
      result,
      errorCode,
      claim.claimToken,
    );
  }
}
