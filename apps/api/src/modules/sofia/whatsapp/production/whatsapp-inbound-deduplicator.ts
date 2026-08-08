import { Inject, Injectable } from '@nestjs/common';
import { WhatsappInboundEventKind } from '@prisma/client';
import type { NormalizedWhatsappEvent } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

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
    if (claimed.created) return { state: 'CLAIMED' as const, inboundEventId: claimed.id, replay: null };
    return {
      state: 'DETERMINISTIC_REPLAY' as const,
      inboundEventId: claimed.id,
      replay: claimed.deterministicResult ?? { processingStatus: claimed.processingStatus === 'CLAIMED' ? 'PROCESSING' : claimed.processingStatus },
    };
  }

  complete(id: string, processingStatus: string, result: unknown, errorCode?: string | null) {
    return this.repository.completeInbound(id, processingStatus, result, errorCode);
  }
}
