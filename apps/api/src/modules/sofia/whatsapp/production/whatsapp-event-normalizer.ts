import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ParsedWhatsappInbound, WhatsappProviderName } from '../whatsapp-provider.adapter';
import { normalizeInboundSender, normalizeProviderAccountObservation } from './whatsapp-inbound-contracts';
import type { NormalizedDeliveryStatus, NormalizedWhatsappEvent, ProviderAccountObservation } from './whatsapp-production.types';

const STATUS_MAP: Record<string, NormalizedDeliveryStatus> = {
  accepted: 'ACCEPTED', queued: 'ACCEPTED', sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED', error: 'FAILED', unknown: 'UNKNOWN',
};

@Injectable()
export class WhatsappEventNormalizer {
  normalize(input: {
    provider: WhatsappProviderName;
    rawPayload: Record<string, unknown>;
    parsed: ParsedWhatsappInbound;
    account: ProviderAccountObservation;
  }): NormalizedWhatsappEvent {
    if (!['qr_gateway', 'hermes', 'mock'].includes(input.provider)) {
      throw new BadRequestException({ code: 'WHATSAPP_PROVIDER_UNSUPPORTED' });
    }
    const provider = input.provider as ProviderAccountObservation['provider'];
    if (input.parsed.provider !== provider || input.account.provider !== provider) {
      throw new BadRequestException({ code: 'WHATSAPP_PROVIDER_CONTRACT_MISMATCH' });
    }
    let account: ProviderAccountObservation;
    try {
      account = normalizeProviderAccountObservation(input.account);
    } catch (error) {
      throw new BadRequestException({ code: this.errorCode(error, 'WHATSAPP_ACCOUNT_OBSERVATION_INVALID') });
    }
    const rawKind = String(input.rawPayload.eventType ?? input.rawPayload.kind ?? input.rawPayload.type ?? '').toLowerCase();
    const statusValue = this.status(input.rawPayload);
    const eventId = this.requiredId(input.parsed.providerEventId ?? input.rawPayload.eventId ?? input.rawPayload.id, 'WHATSAPP_EVENT_ID_REQUIRED');
    const payloadHash = this.hashCanonical(input.rawPayload);
    const occurredAt = this.validDate(input.parsed.timestamp) ?? new Date();

    if (rawKind.includes('status') || statusValue) {
      const messageId = this.requiredId(input.parsed.providerMessageId || input.rawPayload.messageId, 'WHATSAPP_STATUS_MESSAGE_ID_REQUIRED');
      return {
        kind: 'STATUS_EVENT', provider, account, eventId, messageId,
        recipientIdentityHash: this.hash(String(input.rawPayload.recipient ?? input.rawPayload.to ?? account.businessIdentity)),
        status: statusValue ?? 'UNKNOWN', occurredAt, payloadHash,
      };
    }

    if (input.parsed.messageType === 'SYSTEM' || rawKind.includes('unsupported')) {
      return { kind: 'UNSUPPORTED_EVENT', provider, account, eventId, reasonCode: 'WHATSAPP_EVENT_UNSUPPORTED', occurredAt, payloadHash };
    }

    let sender: string;
    try {
      sender = normalizeInboundSender(input.parsed.phone);
    } catch {
      throw new BadRequestException({ code: 'WHATSAPP_SENDER_INVALID' });
    }
    const messageId = this.requiredId(input.parsed.providerMessageId, 'WHATSAPP_MESSAGE_ID_REQUIRED');
    const supportedType = input.parsed.messageType;
    const providerReference = this.string(input.rawPayload.mediaReference ?? input.rawPayload.mediaId ?? input.parsed.mediaUrl);
    const size = Number(input.rawPayload.mediaSizeBytes ?? input.rawPayload.fileSize ?? NaN);
    return {
      kind: 'INBOUND_MESSAGE', provider, account, eventId, messageId, sender,
      senderIdentityHash: this.hash(sender), recipientIdentityHash: this.hash(account.businessIdentity),
      messageType: supportedType, sanitizedText: this.sanitizeText(input.parsed.transcript ?? input.parsed.body),
      media: providerReference || input.parsed.mediaMimeType ? {
        providerReference, declaredMimeType: this.string(input.parsed.mediaMimeType), declaredSizeBytes: Number.isSafeInteger(size) && size >= 0 ? size : null,
      } : null,
      occurredAt, payloadHash,
    };
  }

  private status(payload: Record<string, unknown>) {
    const direct = String(payload.status ?? '').toLowerCase();
    const nested = payload.message && typeof payload.message === 'object' ? String((payload.message as Record<string, unknown>).status ?? '').toLowerCase() : '';
    return STATUS_MAP[direct] ?? STATUS_MAP[nested] ?? null;
  }

  private sanitizeText(value: string | null | undefined) {
    if (!value) return null;
    const sanitized = Array.from(value)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return character === '\n' || character === '\r' || character === '\t' || (code >= 32 && code !== 127);
      })
      .join('');
    return sanitized.trim().slice(0, 4_000) || null;
  }

  private requiredId(value: unknown, code: string) {
    const id = this.string(value);
    if (!id || id.length > 256) throw new BadRequestException({ code });
    return id;
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : null;
  }

  private validDate(value: Date | null | undefined) {
    return value && Number.isFinite(value.getTime()) ? value : null;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private hashCanonical(payload: Record<string, unknown>) {
    try {
      return this.hash(JSON.stringify(this.sort(payload, 0, new WeakSet<object>())));
    } catch {
      throw new BadRequestException({ code: 'WHATSAPP_PAYLOAD_NOT_NORMALIZABLE' });
    }
  }

  private sort(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (depth > 20) throw new Error('payload depth exceeded');
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new Error('cyclic payload');
      seen.add(value);
      const result = value.map((item) => this.sort(item, depth + 1, seen));
      seen.delete(value);
      return result;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value as object)) throw new Error('cyclic payload');
    seen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1_000) throw new Error('payload breadth exceeded');
    const result = Object.fromEntries(
      entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, this.sort(item, depth + 1, seen)]),
    );
    seen.delete(value as object);
    return result;
  }

  private errorCode(error: unknown, fallback: string) {
    return error instanceof Error && /^WHATSAPP_[A-Z_]+$/.test(error.message) ? error.message : fallback;
  }
}
