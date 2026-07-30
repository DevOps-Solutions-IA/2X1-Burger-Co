import type { ConfigService } from '@nestjs/config';
import { HermesWhatsappProvider } from './hermes-whatsapp.provider';
import { SofiaWhatsappQrGatewayProvider } from './qr-gateway/sofia-whatsapp-qr-gateway.provider';

describe('WhatsApp provider fallback identifiers', () => {
  const syntheticPayload = {
    phone: '573000000000',
    text: 'mensaje sintético',
    messageType: 'TEXT',
  };

  it('derives deterministic QR identifiers when the transport omits them', () => {
    const provider = new SofiaWhatsappQrGatewayProvider();
    const first = provider.parseInboundWebhook(syntheticPayload);
    const retry = provider.parseInboundWebhook(syntheticPayload);

    expect(first.providerMessageId).toBe(retry.providerMessageId);
    expect(first.providerEventId).toBe(retry.providerEventId);
  });

  it('derives deterministic Hermes identifiers when the transport omits them', () => {
    const provider = new HermesWhatsappProvider({} as ConfigService);
    const first = provider.parseInboundWebhook(syntheticPayload);
    const retry = provider.parseInboundWebhook(syntheticPayload);

    expect(first.providerMessageId).toBe(retry.providerMessageId);
    expect(first.providerEventId).toBe(retry.providerEventId);
  });
});
