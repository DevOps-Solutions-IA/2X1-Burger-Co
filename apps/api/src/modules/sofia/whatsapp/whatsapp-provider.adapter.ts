export type WhatsappMode = 'disabled' | 'mock' | 'receive_only' | 'supervised' | 'auto';
export type WhatsappProviderName = 'mock' | 'hermes' | 'qr_gateway' | 'none';

export type ParsedWhatsappInbound = {
  provider: WhatsappProviderName;
  providerEventId: string | null;
  providerMessageId: string;
  providerConversationId?: string | null;
  phone: string;
  customerName?: string | null;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  transcript?: string | null;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'INTERACTIVE' | 'SYSTEM';
  timestamp?: Date | null;
  rawPayload: Record<string, unknown>;
};

export type WhatsappSendInput = {
  to: string;
  body: string;
  mediaUrl?: string | null;
  idempotencyKey: string;
};

export type WhatsappSendResult = {
  providerMessageId: string | null;
  status: 'SENT' | 'FAILED';
  rawPayload?: Record<string, unknown>;
  errorMessage?: string;
};

export abstract class WhatsappProviderAdapter {
  abstract readonly provider: WhatsappProviderName;
  abstract parseInboundWebhook(rawPayload: Record<string, unknown>, headers: Record<string, string | string[] | undefined>): ParsedWhatsappInbound;
  abstract verifyWebhookSignature(
    rawPayload: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ): boolean;
  abstract sendTextMessage(input: WhatsappSendInput): Promise<WhatsappSendResult>;
  abstract sendMediaMessage(input: WhatsappSendInput): Promise<WhatsappSendResult>;

  getMessageStatus(_providerMessageId: string) {
    return Promise.resolve('UNKNOWN');
  }

  normalizePhone(phone: string) {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('57')) return digits;
    if (digits.length === 10) return `57${digits}`;
    return digits;
  }

  buildIdempotencyKey(event: Pick<ParsedWhatsappInbound, 'provider' | 'providerEventId' | 'providerMessageId' | 'phone' | 'body'>) {
    return [event.provider, event.providerEventId ?? event.providerMessageId, event.phone, event.body ?? ''].join(':');
  }
}
