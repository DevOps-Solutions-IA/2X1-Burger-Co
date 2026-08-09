import type { ConfigService } from '@nestjs/config';
import { DeepSeekAIProvider } from '../modules/sofia/ai/deepseek-ai.provider';
import type { SofiaAIAnalysisInput } from '../modules/sofia/ai/sofia-ai-provider.adapter';
import { CommercialResponseComposer } from '../modules/sofia/commercial/response/commercial-response.composer';
import type {
  CommercialFactEnvelope,
  CommercialLanguageGenerator,
} from '../modules/sofia/commercial/response/commercial-response.types';
import { CommercialResponseValidator } from '../modules/sofia/commercial/response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from '../modules/sofia/commercial/response/safe-commercial-response.templates';
import type { SofiaPromptService } from '../modules/sofia/prompt/sofia-prompt.service';

const BURST_SIZE = 32;

function analysisInput(index: number): SofiaAIAnalysisInput {
  return {
    conversationId: `phase7-ai-outage-${index}`,
    customerMessage: 'Hola, quiero ver el menu',
    normalizedMessage: 'hola quiero ver el menu',
    currentDraftSnapshot: null,
    availableOffersSnapshot: [],
    availableProductsSnapshot: [],
    paymentOptionsSnapshot: null,
    businessRulesSnapshot: {
      maxiFamilyCopy: 'copy-controlado',
      forbiddenMaxiFamilyClaims: [],
      noPaidFromAi: true,
      noInventedProducts: true,
      noInventedPrices: true,
    },
    mode: 'dry_run',
    ruleIntent: 'ASK_MENU',
    ruleConfidence: 0.8,
    ruleSuggestedReply: 'Puedo mostrarte el menu disponible.',
  };
}

function aiProvider() {
  const values: Record<string, unknown> = {
    DEEPSEEK_ENABLED: true,
    DEEPSEEK_API_KEY: 'phase7-test-only-key',
    DEEPSEEK_BASE_URL: 'https://deepseek.invalid',
    DEEPSEEK_MAX_RETRIES: 0,
    DEEPSEEK_TIMEOUT_MS: 500,
  };
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  const prompts = {
    getCompiledSystemPrompt: jest.fn().mockResolvedValue('PHASE7_BOUNDED_PROMPT'),
  } as unknown as SofiaPromptService;
  return new DeepSeekAIProvider(config, prompts);
}

function dependencyFacts(index: number): CommercialFactEnvelope {
  return {
    responsePurpose: 'DEPENDENCY_FAILURE',
    allowedFacts: ['NO_OPERATIONAL_MUTATION'],
    allowedOptions: [],
    forbiddenClaims: ['pedido ya creado', 'pago confirmado'],
    customerContextSafe: { preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' },
    fulfillment: null,
    paymentOptions: [],
    items: [],
    subtotal: null,
    deliveryFee: null,
    total: null,
    addressSafe: null,
    missingFields: [`dependency-${index}`],
    confirmationRequired: false,
    handoffRequired: false,
    reasonCode: 'DEPENDENCY_UNAVAILABLE',
  };
}

describe('Phase 7 bounded AI outage load', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('falls back deterministically for a concurrent provider outage without operational side effects', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('synthetic network outage'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = aiProvider();

    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, index) => provider.analyzeMessage(analysisInput(index))),
    );

    expect(fetchMock).toHaveBeenCalledTimes(BURST_SIZE);
    expect(results).toHaveLength(BURST_SIZE);
    for (const result of results) {
      expect(result).toMatchObject({
        provider: 'deepseek',
        fallbackUsed: true,
        intent: 'ASK_MENU',
        suggestedReply: 'Puedo mostrarte el menu disponible.',
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
      });
      expect(result.diagnostics).toContain('AI_PROVIDER_FALLBACK:DEEPSEEK_NETWORK_ERROR');
    }
  });

  it('contains a language-generator outage with safe templates across a bounded burst', async () => {
    const generator: CommercialLanguageGenerator = {
      compose: jest.fn().mockRejectedValue(new Error('synthetic composer outage')),
    };
    const composer = new CommercialResponseComposer(
      generator,
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );

    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, index) => composer.compose(dependencyFacts(index))),
    );

    expect(generator.compose).toHaveBeenCalledTimes(BURST_SIZE);
    expect(new Set(results.map((result) => result.text)).size).toBe(1);
    for (const result of results) {
      expect(result).toMatchObject({ source: 'SAFE_TEMPLATE', validation: { valid: true } });
      expect(result.text).not.toMatch(/pagad[oa]|pedido (ya )?creado/i);
    }
  });
});
