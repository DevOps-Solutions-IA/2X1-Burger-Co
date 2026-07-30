import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ParsedWhatsappInbound,
  WhatsappProviderAdapter,
  WhatsappSendInput,
  WhatsappSendResult,
} from '../whatsapp-provider.adapter';

@Injectable()
export class SofiaWhatsappQrGatewayProvider extends WhatsappProviderAdapter {
  readonly provider = 'qr_gateway' as const;

  parseInboundWebhook(rawPayload: Record<string, unknown>): ParsedWhatsappInbound {
    const nestedMessage = typeof rawPayload.message === 'object' && rawPayload.message ? (rawPayload.message as Record<string, unknown>) : null;
    const phone = this.normalizePhone(String(rawPayload.phone ?? rawPayload.from ?? nestedMessage?.from ?? ''));
    const providerMessageId = String(
      rawPayload.externalMessageId ??
        rawPayload.providerMessageId ??
        rawPayload.messageId ??
        nestedMessage?.id ??
        `qr-${createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex').slice(0, 24)}`,
    );
    const providerEventId = rawPayload.providerEventId ? String(rawPayload.providerEventId) : `qr-event-${providerMessageId}`;
    const transcript = rawPayload.transcript ? String(rawPayload.transcript) : nestedMessage?.transcript ? String(nestedMessage.transcript) : null;
    const mediaUrl = rawPayload.mediaUrl ? String(rawPayload.mediaUrl) : nestedMessage?.mediaUrl ? String(nestedMessage.mediaUrl) : null;
    const body = rawPayload.text
      ? String(rawPayload.text)
      : rawPayload.body
        ? String(rawPayload.body)
        : nestedMessage?.body
          ? String(nestedMessage.body)
          : transcript;
    const rawType = String(rawPayload.messageType ?? rawPayload.type ?? nestedMessage?.type ?? (mediaUrl ? 'IMAGE' : 'TEXT')).toUpperCase();
    const messageType =
      rawType === 'AUDIO' ? 'AUDIO' : rawType === 'IMAGE' ? 'IMAGE' : rawType === 'INTERACTIVE' ? 'INTERACTIVE' : rawType === 'SYSTEM' ? 'SYSTEM' : 'TEXT';
    const rawSummary =
      typeof rawPayload.rawSummaryJson === 'object' && rawPayload.rawSummaryJson && !Array.isArray(rawPayload.rawSummaryJson)
        ? (rawPayload.rawSummaryJson as Record<string, unknown>)
        : null;
    const source = rawSummary?.source ? String(rawSummary.source) : rawPayload.source ? String(rawPayload.source) : null;

    return {
      provider: this.provider,
      providerEventId,
      providerMessageId,
      providerConversationId: rawPayload.providerConversationId ? String(rawPayload.providerConversationId) : `qr:${phone}`,
      phone,
      customerName: rawPayload.customerName ? String(rawPayload.customerName) : null,
      body,
      mediaUrl,
      mediaMimeType: rawPayload.mediaMimeType ? String(rawPayload.mediaMimeType) : null,
      transcript,
      messageType,
      timestamp: rawPayload.timestamp ? new Date(String(rawPayload.timestamp)) : null,
      rawPayload: {
        provider: 'qr_gateway',
        summary: {
          source,
          externalMessageId: providerMessageId,
          hasText: Boolean(body),
          hasMedia: Boolean(mediaUrl),
          messageType,
          fromMe: rawPayload.fromMe === true,
        },
      },
    };
  }

  verifyWebhookSignature() {
    return true;
  }

  async sendTextMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    return this.blockedSend(input);
  }

  async sendMediaMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    return this.blockedSend(input);
  }

  private blockedSend(input: WhatsappSendInput): WhatsappSendResult {
    const suffix = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16);
    return {
      providerMessageId: null,
      status: 'FAILED',
      rawPayload: { provider: 'qr_gateway', blocked: true, reason: 'BLOCKED_REAL_SEND_DISABLED', localRef: suffix },
      errorMessage: 'BLOCKED_REAL_SEND_DISABLED',
    };
  }
}
