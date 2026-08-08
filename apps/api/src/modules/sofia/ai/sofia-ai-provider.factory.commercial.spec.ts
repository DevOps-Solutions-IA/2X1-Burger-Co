import { SofiaAIProviderFactory } from './sofia-ai-provider.factory';
import type { CommercialFactEnvelope } from '../commercial/response/commercial-response.types';

const facts: CommercialFactEnvelope = {
  responsePurpose: 'ASK_PAYMENT',
  allowedFacts: ['DRAFT_ONLY'],
  allowedOptions: ['ONLINE', 'PAY_AT_PICKUP'],
  forbiddenClaims: ['pedido ya creado'],
  customerContextSafe: { preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' },
  fulfillment: 'TAKEAWAY',
  paymentOptions: ['ONLINE', 'PAY_AT_PICKUP'],
  items: [],
  subtotal: null,
  deliveryFee: null,
  total: null,
  addressSafe: null,
  missingFields: ['paymentPreference'],
  confirmationRequired: false,
  handoffRequired: false,
  reasonCode: null,
};

const factory = (values: Record<string, unknown>) => {
  const deepSeek = { composeCommercialResponse: jest.fn(async () => '¿Lo pagas ahora en línea o al recoger?') };
  const service = new SofiaAIProviderFactory(
    { get: jest.fn((key: string) => values[key]) } as never,
    {} as never,
    deepSeek as never,
    {} as never,
    {} as never,
  );
  return { service, deepSeek };
};

describe('Sofia AI provider bounded commercial composition', () => {
  it.each(['disabled', 'auto'])('keeps commercial generation disabled in mode %s', async (mode) => {
    const { service, deepSeek } = factory({ SOFIA_AI_MODE: mode, SOFIA_AI_PROVIDER: 'deepseek' });
    await expect(service.composeCommercialResponse(facts)).resolves.toBeNull();
    expect(deepSeek.composeCommercialResponse).not.toHaveBeenCalled();
  });

  it.each(['dry_run', 'suggest', 'supervised'])('reuses DeepSeek only for bounded mode %s', async (mode) => {
    const { service, deepSeek } = factory({ SOFIA_AI_MODE: mode, SOFIA_AI_PROVIDER: 'deepseek' });
    await expect(service.composeCommercialResponse(facts)).resolves.toContain('al recoger');
    expect(deepSeek.composeCommercialResponse).toHaveBeenCalledWith(facts);
  });

  it('does not invoke a general AI provider when rules are selected', async () => {
    const { service, deepSeek } = factory({ SOFIA_AI_MODE: 'supervised', SOFIA_AI_PROVIDER: 'rules' });
    await expect(service.composeCommercialResponse(facts)).resolves.toBeNull();
    expect(deepSeek.composeCommercialResponse).not.toHaveBeenCalled();
  });
});
