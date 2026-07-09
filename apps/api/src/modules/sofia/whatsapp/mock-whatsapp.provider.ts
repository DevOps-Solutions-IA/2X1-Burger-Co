import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ParsedWhatsappInbound,
  WhatsappProviderAdapter,
  WhatsappSendInput,
  WhatsappSendResult,
} from './whatsapp-provider.adapter';

@Injectable()
export class MockWhatsappProvider extends WhatsappProviderAdapter {
  readonly provider = 'mock' as const;

  parseInboundWebhook(rawPayload: Record<string, unknown>): ParsedWhatsappInbound {
    const nestedMessage = typeof rawPayload.message === 'object' && rawPayload.message ? (rawPayload.message as Record<string, unknown>) : null;
    const phone = this.normalizePhone(String(rawPayload.phone ?? rawPayload.from ?? nestedMessage?.from ?? ''));
    const providerMessageId = String(rawPayload.providerMessageId ?? rawPayload.messageId ?? nestedMessage?.id ?? `mock-${Date.now()}`);
    const providerEventId = rawPayload.providerEventId ? String(rawPayload.providerEventId) : `mock-event-${providerMessageId}`;
    const transcript = rawPayload.transcript ? String(rawPayload.transcript) : nestedMessage?.transcript ? String(nestedMessage.transcript) : null;
    const mediaUrl = rawPayload.mediaUrl ? String(rawPayload.mediaUrl) : nestedMessage?.mediaUrl ? String(nestedMessage.mediaUrl) : null;
    const body = rawPayload.body ? String(rawPayload.body) : nestedMessage?.body ? String(nestedMessage.body) : transcript;
    const rawType = String(rawPayload.messageType ?? rawPayload.type ?? nestedMessage?.type ?? (mediaUrl ? 'IMAGE' : 'TEXT')).toUpperCase();
    const messageType = rawType === 'AUDIO' ? 'AUDIO' : rawType === 'IMAGE' ? 'IMAGE' : rawType === 'INTERACTIVE' ? 'INTERACTIVE' : 'TEXT';

    return {
      provider: this.provider,
      providerEventId,
      providerMessageId,
      providerConversationId: rawPayload.providerConversationId ? String(rawPayload.providerConversationId) : null,
      phone,
      customerName: rawPayload.customerName ? String(rawPayload.customerName) : null,
      body,
      mediaUrl,
      mediaMimeType: rawPayload.mediaMimeType ? String(rawPayload.mediaMimeType) : null,
      transcript,
      messageType,
      timestamp: rawPayload.timestamp ? new Date(String(rawPayload.timestamp)) : null,
      rawPayload,
    };
  }

  verifyWebhookSignature() {
    return true;
  }

  async sendTextMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    const suffix = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24);
    return {
      providerMessageId: `mock-out-${suffix}`,
      status: 'SENT',
      rawPayload: { mock: true, to: input.to, body: input.body },
    };
  }

  async sendMediaMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    const suffix = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24);
    return {
      providerMessageId: `mock-media-${suffix}`,
      status: 'SENT',
      rawPayload: { mock: true, to: input.to, body: input.body, mediaUrl: input.mediaUrl },
    };
  }
}
