import type { ConfigService } from '@nestjs/config';
import type { HermesWhatsappProvider } from './hermes-whatsapp.provider';
import type { MockWhatsappProvider } from './mock-whatsapp.provider';
import type { NullWhatsappProvider } from './null-whatsapp.provider';
import type { SofiaWhatsappQrGatewayProvider } from './qr-gateway/sofia-whatsapp-qr-gateway.provider';
import { WhatsappProviderFactory } from './whatsapp-provider.factory';

function expectReasonCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error('Expected action to throw.');
  } catch (error) {
    expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual({ code });
  }
}

describe('WhatsappProviderFactory runtime overrides', () => {
  const mockProvider = { provider: 'mock' } as MockWhatsappProvider;
  const hermesProvider = { provider: 'hermes' } as HermesWhatsappProvider;
  const qrProvider = { provider: 'qr_gateway' } as SofiaWhatsappQrGatewayProvider;
  const nullProvider = { provider: 'none' } as NullWhatsappProvider;

  function factory(values: Record<string, unknown>) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    return new WhatsappProviderFactory(config, mockProvider, hermesProvider, qrProvider, nullProvider);
  }

  it('ignores provider and mode header/route overrides outside test runtime', () => {
    const subject = factory({ NODE_ENV: 'production', WHATSAPP_MODE: 'receive_only', WHATSAPP_PROVIDER: 'qr_gateway' });

    expect(subject.resolveMode({ 'x-sofia-whatsapp-mode': 'auto' })).toBe('receive_only');
    expect(subject.resolveProviderName('mock', { 'x-sofia-whatsapp-provider': 'hermes' })).toBe('qr_gateway');
    expect(subject.isAutoReplyAllowed(1, true, { 'x-sofia-auto-reply-enabled': 'true' })).toBe(false);
    expectReasonCode(() => subject.getProvider('mock'), 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN');
  });

  it('retains explicit overrides only for isolated test suites', () => {
    const subject = factory({
      NODE_ENV: 'test',
      WHATSAPP_MODE: 'disabled',
      WHATSAPP_PROVIDER: 'none',
      SOFIA_AUTO_REPLY_MIN_CONFIDENCE: 0.8,
      SOFIA_REPLY_OUTSIDE_HOURS: false,
    });

    expect(subject.resolveMode({ 'x-sofia-whatsapp-mode': 'mock' })).toBe('mock');
    expect(subject.resolveProviderName('qr_gateway', { 'x-sofia-whatsapp-provider': 'mock' })).toBe('mock');
    expect(subject.isAutoReplyAllowed(0.9, true, { 'x-sofia-auto-reply-enabled': 'true' })).toBe(true);
  });
});
