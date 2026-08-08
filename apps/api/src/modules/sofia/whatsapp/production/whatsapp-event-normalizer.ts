import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ParsedWhatsappInbound, WhatsappProviderName } from '../whatsapp-provider.adapter';
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
    const rawKind = String(input.rawPayload.eventType ?? input.rawPayload.kind ?? input.rawPayload.type ?? '').toLowerCase();
    const statusValue = this.status(input.rawPayload);
    const eventId = this.requiredId(input.parsed.providerEventId ?? input.rawPayload.eventId ?? input.rawPayload.id, 'WHATSAPP_EVENT_ID_REQUIRED');
    const payloadHash = this.hashCanonical(input.rawPayload);
    const occurredAt = this.validDate(input.parsed.timestamp) ?? new Date();

    if (rawKind.includes('status') || statusValue) {
      const messageId = this.requiredId(input.parsed.providerMessageId || input.rawPayload.messageId, 'WHATSAPP_STATUS_MESSAGE_ID_REQUIRED');
      return {
        kind: 'STATUS_EVENT', provider, account: input.account, eventId, messageId,
        recipientIdentityHash: this.hash(String(input.rawPayload.recipient ?? input.rawPayload.to ?? input.account.businessIdentity)),
        status: statusValue ?? 'UNKNOWN', occurredAt, payloadHash,
      };
    }

    if (input.parsed.messageType === 'SYSTEM' || rawKind.includes('unsupported')) {
      return { kind: 'UNSUPPORTED_EVENT', provider, account: input.account, eventId, reasonCode: 'WHATSAPP_EVENT_UNSUPPORTED', occurredAt, payloadHash };
    }

    const sender = this.normalizePhone(input.parsed.phone);
    if (!sender) throw new BadRequestException({ code: 'WHATSAPP_SENDER_INVALID' });
    const messageId = this.requiredId(input.parsed.providerMessageId, 'WHATSAPP_MESSAGE_ID_REQUIRED');
    const supportedType = input.parsed.messageType;
    const providerReference = this.string(input.rawPayload.mediaReference ?? input.rawPayload.mediaId ?? input.parsed.mediaUrl);
    const size = Number(input.rawPayload.mediaSizeBytes ?? input.rawPayload.fileSize ?? NaN);
    return {
      kind: 'INBOUND_MESSAGE', provider, account: input.account, eventId, messageId, sender,
      senderIdentityHash: this.hash(sender), recipientIdentityHash: this.hash(input.account.businessIdentity),
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

  private normalizePhone(value: string) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('57') ? digits : digits.length === 10 ? `57${digits}` : digits;
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
    return this.hash(JSON.stringify(this.sort(payload)));
  }

  private sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sort(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, this.sort(item)]));
  }
}
