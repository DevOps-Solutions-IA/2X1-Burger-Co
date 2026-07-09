import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  ParsedWhatsappInbound,
  WhatsappProviderAdapter,
  WhatsappSendInput,
  WhatsappSendResult,
} from './whatsapp-provider.adapter';

@Injectable()
export class NullWhatsappProvider extends WhatsappProviderAdapter {
  readonly provider = 'none' as const;

  parseInboundWebhook(rawPayload: Record<string, unknown>): ParsedWhatsappInbound {
    return {
      provider: this.provider,
      providerEventId: rawPayload.providerEventId ? String(rawPayload.providerEventId) : null,
      providerMessageId: rawPayload.providerMessageId ? String(rawPayload.providerMessageId) : `none-${Date.now()}`,
      phone: this.normalizePhone(String(rawPayload.phone ?? rawPayload.from ?? '')),
      body: rawPayload.body ? String(rawPayload.body) : null,
      messageType: 'TEXT',
      rawPayload,
    };
  }

  verifyWebhookSignature() {
    return false;
  }

  async sendTextMessage(_input: WhatsappSendInput): Promise<WhatsappSendResult> {
    throw new ServiceUnavailableException('WhatsApp provider no configurado.');
  }

  async sendMediaMessage(_input: WhatsappSendInput): Promise<WhatsappSendResult> {
    throw new ServiceUnavailableException('WhatsApp provider no configurado.');
  }
}
