import { ConfigService } from '@nestjs/config';
import { SofiaPromptService } from '../prompt/sofia-prompt.service';
import { DeepSeekAIProvider } from './deepseek-ai.provider';
import type { SofiaAIAnalysisInput } from './sofia-ai-provider.adapter';

describe('DeepSeekAIProvider prompt contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the active compiled prompt instead of a provider-local prompt', async () => {
    const values: Record<string, unknown> = {
      DEEPSEEK_ENABLED: true,
      DEEPSEEK_API_KEY: 'test-only-key',
      DEEPSEEK_BASE_URL: 'https://deepseek.invalid',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_MAX_RETRIES: 0,
      DEEPSEEK_TIMEOUT_MS: 500,
      DEEPSEEK_MAX_TOKENS: 300,
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const promptService = {
      getCompiledSystemPrompt: jest.fn().mockResolvedValue('PROMPT_ACTIVO_V2'),
    } as unknown as SofiaPromptService;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ intent: 'GREETING', confidence: 0.99 }) } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new DeepSeekAIProvider(config, promptService);
    const input: SofiaAIAnalysisInput = {
      conversationId: 'conversation-test',
      customerMessage: 'Hola',
      normalizedMessage: 'hola',
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
      ruleIntent: 'GREETING',
      ruleConfidence: 0.8,
    };

    await provider.analyzeMessage(input);

    expect(promptService.getCompiledSystemPrompt).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'PROMPT_ACTIVO_V2' });
  });
});
