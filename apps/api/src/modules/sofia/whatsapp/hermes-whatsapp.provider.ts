import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BoundedJsonResponseError, readBoundedJson } from '../../../common/security/bounded-json-response';
import {
  ParsedWhatsappInbound,
  WhatsappProviderAdapter,
  WhatsappSendInput,
  WhatsappSendResult,
} from './whatsapp-provider.adapter';

@Injectable()
export class HermesWhatsappProvider extends WhatsappProviderAdapter {
  readonly provider = 'hermes' as const;
  private static readonly MAX_PROVIDER_MESSAGE_ID_LENGTH = 256;
  private static readonly MAX_RESPONSE_BYTES = 1_048_576;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  private isConfigured() {
    return Boolean(this.configService.get<string>('HERMES_BASE_URL') && this.configService.get<string>('HERMES_API_TOKEN'));
  }

  parseInboundWebhook(rawPayload: Record<string, unknown>): ParsedWhatsappInbound {
    const message = typeof rawPayload.message === 'object' && rawPayload.message ? (rawPayload.message as Record<string, unknown>) : rawPayload;
    const phone = this.normalizePhone(String(message.from ?? rawPayload.from ?? rawPayload.phone ?? ''));
    const providerMessageId = String(
      message.id ??
        rawPayload.messageId ??
        rawPayload.providerMessageId ??
        `hermes-${createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex').slice(0, 24)}`,
    );
    const providerEventId = rawPayload.id ? String(rawPayload.id) : rawPayload.eventId ? String(rawPayload.eventId) : `hermes-event-${providerMessageId}`;
    const rawType = String(message.type ?? rawPayload.type ?? 'text').toUpperCase();
    const transcript = message.transcript ? String(message.transcript) : rawPayload.transcript ? String(rawPayload.transcript) : null;
    const body = message.text ? String(message.text) : message.body ? String(message.body) : rawPayload.body ? String(rawPayload.body) : transcript;
    const media = typeof message.media === 'object' && message.media ? (message.media as Record<string, unknown>) : null;
    const mediaUrl = media?.url ? String(media.url) : rawPayload.mediaUrl ? String(rawPayload.mediaUrl) : null;
    const messageType =
      rawType === 'AUDIO'
        ? 'AUDIO'
        : rawType === 'IMAGE'
          ? 'IMAGE'
          : rawType === 'DOCUMENT'
            ? 'DOCUMENT'
            : rawType === 'INTERACTIVE'
              ? 'INTERACTIVE'
              : 'TEXT';

    return {
      provider: this.provider,
      providerEventId,
      providerMessageId,
      providerConversationId: rawPayload.conversationId ? String(rawPayload.conversationId) : null,
      phone,
      customerName: rawPayload.customerName ? String(rawPayload.customerName) : null,
      body,
      mediaUrl,
      mediaMimeType: media?.mimeType ? String(media.mimeType) : rawPayload.mediaMimeType ? String(rawPayload.mediaMimeType) : null,
      transcript,
      messageType,
      timestamp: rawPayload.timestamp ? new Date(String(rawPayload.timestamp)) : null,
      rawPayload,
    };
  }

  verifyWebhookSignature(
    _rawPayload: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ) {
    const secret = this.configService.get<string>('HERMES_WEBHOOK_SECRET');
    if (!secret || !rawBody?.length) return false;
    const headerValue = headers['x-hermes-signature'] ?? headers['X-Hermes-Signature'];
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const left = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    const right = Buffer.from(expected, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async sendTextMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    return this.sendMessage(input);
  }

  async sendMediaMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    return this.sendMessage(input);
  }

  private async sendMessage(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Hermes no está configurado.');
    }

    const baseUrl = this.configService.get<string>('HERMES_BASE_URL')!.replace(/\/$/, '');
    const token = this.configService.get<string>('HERMES_API_TOKEN')!;
    const timeoutMs = Number(this.configService.get<string>('HERMES_TIMEOUT_MS') ?? 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({ to: input.to, text: input.body, mediaUrl: input.mediaUrl ?? undefined }),
        signal: controller.signal,
      });
      let body: Record<string, unknown> = {};
      try {
        body = await readBoundedJson<Record<string, unknown>>(
          response,
          HermesWhatsappProvider.MAX_RESPONSE_BYTES,
        );
      } catch (error) {
        if (
          error instanceof BoundedJsonResponseError
          && error.code === 'PROVIDER_RESPONSE_INVALID_JSON'
          && !response.ok
        ) {
          body = {};
        } else {
          throw new Error('HERMES_PROVIDER_RESPONSE_INVALID');
        }
      }
      if (!response.ok) {
        return { providerMessageId: null, status: 'FAILED', rawPayload: body, errorMessage: `Hermes HTTP ${response.status}` };
      }
      const providerMessageId = this.validProviderMessageId(body.id);
      if (!providerMessageId) {
        // Hermes may have accepted the request even when its response is incomplete.
        // Treat that ambiguity as terminal unknown instead of claiming a safe retry.
        throw new Error('HERMES_PROVIDER_MESSAGE_ID_INVALID');
      }
      return { providerMessageId, status: 'SENT', rawPayload: body };
    } finally {
      clearTimeout(timeout);
    }
  }

  private validProviderMessageId(value: unknown) {
    if (typeof value !== 'string') return null;
    if (!value || value.length > HermesWhatsappProvider.MAX_PROVIDER_MESSAGE_ID_LENGTH) return null;
    if (value.trim() !== value || !/^[\x21-\x7e]+$/.test(value)) return null;
    return value;
  }
}
