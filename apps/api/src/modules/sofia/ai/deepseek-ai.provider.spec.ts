import { ConfigService } from '@nestjs/config';
import { SofiaPromptService } from '../prompt/sofia-prompt.service';
import { DeepSeekAIProvider } from './deepseek-ai.provider';
import type { SofiaAIAnalysisInput } from './sofia-ai-provider.adapter';
import type { CommercialFactEnvelope } from '../commercial/response/commercial-response.types';

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
  ruleSuggestedReply: 'Respuesta determinista segura.',
};

function provider(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    DEEPSEEK_ENABLED: true,
    DEEPSEEK_API_KEY: 'test-only-key',
    DEEPSEEK_BASE_URL: 'https://deepseek.invalid',
    DEEPSEEK_MODEL: 'deepseek-v4-flash',
    DEEPSEEK_MAX_RETRIES: 0,
    DEEPSEEK_TIMEOUT_MS: 500,
    DEEPSEEK_MAX_TOKENS: 300,
    SOFIA_AI_REDACT_PERSONAL_DATA: true,
    ...overrides,
  };
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  const promptService = {
    getCompiledSystemPrompt: jest.fn().mockResolvedValue('PROMPT_ACTIVO_V2'),
  } as unknown as SofiaPromptService;
  return { service: new DeepSeekAIProvider(config, promptService), promptService };
}

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('DeepSeekAIProvider resilience', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the active compiled prompt instead of a provider-local prompt', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ intent: 'GREETING', confidence: 0.99 }) } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, promptService } = provider();

    await service.analyzeMessage(input);

    expect(promptService.getCompiledSystemPrompt).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'PROMPT_ACTIVO_V2' });
  });

  it('sends only bounded semantic signals when personal-data redaction is enabled', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: 'ORDER_ITEM',
                confidence: 0.91,
                extractedItems: [{ productRef: 'product-1', quantity: 2 }],
              }),
            },
          },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const personalData = {
      name: 'María Fernanda PII-SENTINEL',
      address: 'Carrera 77 # 19-42 apartamento 501',
      phone: '+57 310 987 6543',
      email: 'maria.pii-sentinel@example.test',
    };
    const customerText = `Hola, soy ${personalData.name}. Vivo en ${personalData.address}, mi teléfono es ${personalData.phone}, correo ${personalData.email}; quiero 2 Maxi Family.`;
    const adversarialInput: SofiaAIAnalysisInput = {
      ...input,
      conversationId: `conversation-${personalData.phone}`,
      customerMessage: customerText,
      normalizedMessage: customerText.toLowerCase(),
      currentDraftSnapshot: {
        customerName: personalData.name,
        customerPhone: personalData.phone,
        deliveryAddress: personalData.address,
        notes: customerText,
        items: [{ name: personalData.name, quantity: 2 }],
      },
      availableProductsSnapshot: [
        {
          id: personalData.phone,
          code: personalData.email,
          name: 'Maxi Family',
          price: 42000,
          available: true,
          categoryName: personalData.address,
        },
      ],
      availableOffersSnapshot: [
        {
          slug: personalData.name,
          name: 'Maxi Family',
          linkedProductId: personalData.phone,
          price: 42000,
          description: customerText,
          imageUrl: `https://example.test/${personalData.phone}`,
          salesHint: personalData.address,
        },
      ],
      paymentOptionsSnapshot: { customerNote: customerText, payerPhone: personalData.phone },
      businessRulesSnapshot: {
        ...input.businessRulesSnapshot,
        maxiFamilyCopy: `${input.businessRulesSnapshot.maxiFamilyCopy} ${personalData.address}`,
        forbiddenMaxiFamilyClaims: [personalData.name, personalData.phone],
      },
      recentMessagesSummary: customerText,
      ruleIntent: 'ORDER_ITEM',
      ruleConfidence: 0.93,
    };

    const output = await provider().service.analyzeMessage(adversarialInput);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ role: string; content: string }> };
    const userContent = body.messages.find((message) => message.role === 'user')?.content ?? '';
    const outbound = JSON.parse(userContent) as {
      privacyMode: string;
      customerSignal: {
        ruleIntent: string;
        semantics: Record<string, boolean>;
        matchedProductRefs: string[];
        matchedOfferRefs: string[];
      };
      draftState: Record<string, unknown>;
    };

    expect(userContent).not.toContain(customerText);
    for (const value of Object.values(personalData)) expect(userContent).not.toContain(value);
    expect(userContent).not.toContain('customerMessage');
    expect(userContent).not.toContain('normalizedMessage');
    expect(outbound).toMatchObject({
      privacyMode: 'PERSONAL_DATA_REDACTED',
      customerSignal: {
        ruleIntent: 'ORDER_ITEM',
        semantics: {
          greeting: true,
          asksCombo: true,
          orderAction: true,
          providesAddress: true,
          providesName: true,
          hasExplicitQuantity: true,
        },
        matchedProductRefs: ['product-1'],
        matchedOfferRefs: ['offer-1'],
      },
      draftState: {
        present: true,
        itemCount: 1,
        hasDeliveryAddress: true,
        hasCustomerName: true,
        hasCustomerPhone: true,
      },
    });
    expect(output).toMatchObject({
      intent: 'ORDER_ITEM',
      extractedItems: [{ productId: personalData.phone, name: 'Maxi Family', quantity: 2, unitPrice: 42000 }],
      fallbackUsed: false,
    });
  });

  it('does not leak personal fields from a direct commercial composition request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, { choices: [{ message: { content: JSON.stringify({ text: 'Respuesta acotada.' }) } }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const envelope: CommercialFactEnvelope = {
      responsePurpose: 'SUMMARIZE_DRAFT',
      allowedFacts: ['DRAFT_ONLY', 'NO_OPERATIONAL_MUTATION'],
      allowedOptions: ['DELIVERY', 'CASH_ON_DELIVERY'],
      forbiddenClaims: ['PII-SENTINEL no debe salir'],
      customerContextSafe: { preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' },
      fulfillment: 'DELIVERY',
      paymentOptions: ['CASH_ON_DELIVERY'],
      items: [{ name: 'María PII-SENTINEL', quantity: 1, unitPrice: 25000, modifiers: [], available: true }],
      subtotal: 25000,
      deliveryFee: 5000,
      total: 30000,
      addressSafe: 'Calle 123 # 45-67 PII-SENTINEL',
      missingFields: ['teléfono +57 300 111 2233'],
      confirmationRequired: true,
      handoffRequired: false,
      reasonCode: 'customer said PII-SENTINEL',
    };

    await expect(provider().service.composeCommercialResponse(envelope)).resolves.toBe('Respuesta acotada.');

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = String(request.body);
    expect(requestBody).not.toContain('PII-SENTINEL');
    expect(requestBody).not.toContain('Calle 123 # 45-67');
    expect(requestBody).not.toContain('+57 300 111 2233');
    expect(requestBody).not.toContain('María');
    const body = JSON.parse(requestBody) as { messages: Array<{ role: string; content: string }> };
    const outbound = JSON.parse(body.messages[1]!.content) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      privacyMode: 'PERSONAL_DATA_REDACTED',
      addressProvided: true,
      missingFieldCount: 1,
      forbiddenClaimCount: 1,
      items: [{ ref: 'item-1', quantity: 1, unitPrice: 25000 }],
    });
  });

  it('keeps the explicit non-redacted mode behavior isolated behind the false flag', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, { choices: [{ message: { content: JSON.stringify({ intent: 'PROVIDE_NAME', confidence: 0.9 }) } }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const rawText = 'Mi nombre es Cliente Explícito';

    await provider({ SOFIA_AI_REDACT_PERSONAL_DATA: false }).service.analyzeMessage({
      ...input,
      customerMessage: rawText,
      normalizedMessage: rawText.toLowerCase(),
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain(rawText);
  });

  it('retries a transient provider failure and then succeeds', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(
        response(200, {
          choices: [{ message: { content: JSON.stringify({ intent: 'GREETING', confidence: 0.9 }) } }],
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_MAX_RETRIES: 1 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.fallbackUsed).toBe(false);
    expect(output.diagnostics).toContain('AI_PROVIDER_USED:deepseek');
  });

  it.each([400, 401, 403, 404, 422])('does not retry non-transient HTTP %s', async (status) => {
    const fetchMock = jest.fn().mockResolvedValue(response(status, {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_MAX_RETRIES: 3 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output.fallbackUsed).toBe(true);
    expect(output.diagnostics).toContain(`AI_PROVIDER_FALLBACK:DEEPSEEK_HTTP_${status}`);
    expect(output.suggestedReply).toBe('Respuesta determinista segura.');
    expect(output.shouldCreateOrder).toBe(false);
    expect(output.shouldGeneratePaymentLink).toBe(false);
  });

  it('does not retry an invalid provider response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid provider json');
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_MAX_RETRIES: 3 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output.diagnostics).toContain('AI_PROVIDER_FALLBACK:DEEPSEEK_INVALID_JSON');
  });

  it('rejects an oversized provider response without retrying or exposing it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ payload: 'x'.repeat(1_048_576) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_MAX_RETRIES: 3 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output.fallbackUsed).toBe(true);
    expect(output.diagnostics).toContain('AI_PROVIDER_FALLBACK:DEEPSEEK_RESPONSE_TOO_LARGE');
  });

  it('bounds timeout retries and falls back without an operational claim', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('request timed out');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_TIMEOUT_MS: 5, DEEPSEEK_MAX_RETRIES: 1 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.diagnostics).toContain('AI_PROVIDER_FALLBACK:DEEPSEEK_TIMEOUT');
    expect(output.suggestedReply).toBe('Respuesta determinista segura.');
    expect(output.shouldCreateOrder).toBe(false);
    expect(output.shouldGeneratePaymentLink).toBe(false);
  });

  it('bounds retries during a provider network outage', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('network unavailable'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const output = await provider({ DEEPSEEK_MAX_RETRIES: 2 }).service.analyzeMessage(input);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(output.diagnostics).toContain('AI_PROVIDER_FALLBACK:DEEPSEEK_NETWORK_ERROR');
    expect(output.fallbackUsed).toBe(true);
  });

  it('probes the real provider endpoint before reporting healthy', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, { data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const health = await provider().service.healthCheck();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://deepseek.invalid/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
    expect(health).toMatchObject({ configured: true, enabled: true, ok: true });
  });

  it('reports an enabled but unavailable provider as unhealthy', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(503, {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const health = await provider().service.healthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(health).toMatchObject({ configured: true, enabled: true, ok: false });
    expect(health.message).toContain('DEEPSEEK_HTTP_503');
  });

  it('does not claim provider health while DeepSeek is disabled', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const health = await provider({ DEEPSEEK_ENABLED: false }).service.healthCheck();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(health).toMatchObject({ enabled: false, ok: false });
  });
});
