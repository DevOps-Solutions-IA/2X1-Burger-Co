import { Inject, Injectable } from '@nestjs/common';
import { WhatsappInboundEventKind } from '@prisma/client';
import type { NormalizedWhatsappEvent } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

@Injectable()
export class WhatsappInboundDeduplicator {
  private readonly claimTokens = new Map<string, string>();

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
      if (claimed.claimToken) {
        this.claimTokens.set(claimed.id, claimed.claimToken);
      }
      return {
        state: 'CLAIMED' as const,
        inboundEventId: claimed.id,
        attempt: claimed.attempt ?? 1,
        leaseExpiresAt: claimed.leaseExpiresAt ?? null,
        replay: null,
      };
    }
    return {
      state: 'DETERMINISTIC_REPLAY' as const,
      inboundEventId: claimed.id,
      replay: claimed.deterministicResult ?? {
        processingStatus: claimed.disposition === 'IN_PROGRESS' ? 'PROCESSING' : claimed.processingStatus,
      },
    };
  }

  async complete(id: string, processingStatus: string, result: unknown, errorCode?: string | null) {
    const claimToken = this.claimTokens.get(id) ?? null;
    try {
      await this.repository.completeInbound(id, processingStatus, result, errorCode, claimToken);
    } finally {
      this.claimTokens.delete(id);
    }
  }
}
