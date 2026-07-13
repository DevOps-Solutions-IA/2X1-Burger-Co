import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SofiaAIAnalysisInput,
  SofiaAIAnalysisOutput,
  SofiaAIExtractedItem,
  SofiaAIHealth,
  SofiaAIIntent,
  SofiaAIProviderAdapter,
} from './sofia-ai-provider.adapter';

const VALID_INTENTS: SofiaAIIntent[] = [
  'GREETING',
  'ASK_MENU',
  'ASK_COMBO',
  'ASK_PRICE',
  'ORDER_ITEM',
  'ADD_ITEM',
  'REMOVE_ITEM',
  'MODIFY_QUANTITY',
  'ASK_DELIVERY',
  'PROVIDE_ADDRESS',
  'PROVIDE_NAME',
  'PROVIDE_PAYMENT_METHOD',
  'CONFIRM_ORDER',
  'CANCEL_ORDER',
  'ASK_HUMAN',
  'UNKNOWN',
];

@Injectable()
export class DeepSeekAIProvider extends SofiaAIProviderAdapter {
  readonly provider = 'deepseek' as const;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async analyzeMessage(input: SofiaAIAnalysisInput): Promise<SofiaAIAnalysisOutput> {
    if (this.isMockScenarioAllowed(input)) {
      return this.mockDeepSeekResponse(input);
    }

    if (!this.isEnabled()) {
      return {
        ...this.rulesOutput(input, ['AI_PROVIDER_FALLBACK:deepseek-disabled']),
        provider: this.provider,
        fallbackUsed: true,
      };
    }

    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    const baseUrl = this.configService.get<string>('DEEPSEEK_BASE_URL');
    if (!apiKey || !baseUrl) {
      return {
        ...this.rulesOutput(input, ['AI_PROVIDER_FALLBACK:deepseek-not-configured']),
        provider: this.provider,
        fallbackUsed: true,
      };
    }

    const prompt = this.buildSystemPrompt();
    const userPayload = this.redactedInput(input);
    const timeoutMs = this.configService.get<number>('DEEPSEEK_TIMEOUT_MS') ?? 12000;
    const maxRetries = this.configService.get<number>('DEEPSEEK_MAX_RETRIES') ?? 2;
    const maxTokens = this.configService.get<number>('DEEPSEEK_MAX_TOKENS') ?? 700;
    const model = this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat';
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: JSON.stringify(userPayload) },
            ],
          }),
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error('DeepSeek respondió sin contenido.');
        return this.parseStructuredOutput(input, content);
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
      }
    }

    return {
      ...this.rulesOutput(input, [`AI_PROVIDER_FALLBACK:${lastError instanceof Error ? lastError.message : 'deepseek-error'}`]),
      provider: this.provider,
      fallbackUsed: true,
    };
  }

  async classifyIntent(input: SofiaAIAnalysisInput) {
    const output = await this.analyzeMessage(input);
    return { intent: output.intent, confidence: output.confidence };
  }

  async extractOrderEntities(input: SofiaAIAnalysisInput): Promise<SofiaAIExtractedItem[]> {
    return (await this.analyzeMessage(input)).extractedItems;
  }

  async draftReply(input: SofiaAIAnalysisInput) {
    return (await this.analyzeMessage(input)).suggestedReply;
  }

  async evaluateConfidence(input: SofiaAIAnalysisInput) {
    return (await this.analyzeMessage(input)).confidence;
  }

  async shouldHandoff(input: SofiaAIAnalysisInput) {
    return (await this.analyzeMessage(input)).shouldHandoff;
  }

  async healthCheck(): Promise<SofiaAIHealth> {
    const enabled = this.isEnabled();
    const configured = Boolean(this.configService.get<string>('DEEPSEEK_API_KEY') && this.configService.get<string>('DEEPSEEK_BASE_URL'));
    return {
      provider: this.provider,
      configured,
      enabled,
      ok: enabled ? configured : true,
      message: enabled
        ? configured
          ? 'DeepSeek configurado. La llamada real queda bajo timeout/retries.'
          : 'DeepSeek habilitado sin credenciales completas; se usará fallback a reglas.'
        : 'DeepSeek deshabilitado por configuración segura.',
    };
  }

  private isEnabled() {
    return this.configService.get<boolean>('DEEPSEEK_ENABLED') === true;
  }

  private isMockScenarioAllowed(input: SofiaAIAnalysisInput) {
    return process.env.NODE_ENV === 'test' && input.mockScenario && input.mockScenario !== 'none';
  }

  private mockDeepSeekResponse(input: SofiaAIAnalysisInput): SofiaAIAnalysisOutput {
    const scenario = input.mockScenario;
    if (scenario === 'timeout' || scenario === 'invalid_json') {
      return {
        ...this.rulesOutput(input, [`AI_PROVIDER_FALLBACK:${scenario}`]),
        provider: this.provider,
        fallbackUsed: true,
      };
    }
    if (scenario === 'invented_product') {
      return {
        ...this.rulesOutput(input, ['AI_PROVIDER_USED:deepseek-mock']),
        provider: this.provider,
        confidence: 0.91,
        intent: 'ORDER_ITEM',
        extractedItems: [{ name: 'Sushi galáctico', quantity: 1, unitPrice: 99999 }],
        suggestedReply: 'Claro, el Sushi galáctico vale COP 99.999 y lo dejamos pagado.',
        shouldCreateDraft: true,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
      };
    }
    if (scenario === 'mark_paid') {
      return {
        ...this.rulesOutput(input, ['AI_PROVIDER_USED:deepseek-mock']),
        provider: this.provider,
        confidence: 0.9,
        suggestedReply: 'Tu pedido ya quedó pagado y confirmado.',
        safetyFlags: ['PAYMENT_CLAIM'],
      };
    }
    if (scenario === 'low_confidence') {
      return {
        ...this.rulesOutput(input, ['AI_PROVIDER_USED:deepseek-mock']),
        provider: this.provider,
        confidence: 0.4,
        shouldHandoff: true,
        handoffReason: 'LOW_CONFIDENCE',
      };
    }
    return {
      ...this.rulesOutput(input, ['AI_PROVIDER_USED:deepseek-mock']),
      provider: this.provider,
      confidence: Math.max(input.ruleConfidence, 0.88),
      intent: input.normalizedMessage.includes('maxi') ? 'ORDER_ITEM' : input.ruleIntent,
      suggestedReply: input.normalizedMessage.includes('maxi')
        ? 'El Maxi Family trae 6 burgers, una porción personal de papitas y una Pepsi 1.5 L. Si quieren más acompañamiento, puedo agregar papitas adicionales.'
        : input.ruleSuggestedReply ?? 'Te ayudo con tu pedido usando el catálogo real.',
    };
  }

  private buildSystemPrompt() {
    return [
      'Eres Sofía, asistente de pedidos de 2X1 Burger Co.',
      'Tu función es ayudar a entender mensajes de clientes y proponer respuestas cortas.',
      'No puedes inventar productos, precios, promociones, stock, pagos ni tiempos.',
      'Solo puedes usar los datos que el sistema te entrega en el snapshot.',
      'Si falta información, pregunta solo lo faltante. Si hay duda, escala a humano.',
      'Para Maxi Family siempre debes decir que incluye 6 burgers, una porción personal de papitas y una Pepsi 1.5 L.',
      'Nunca uses claims prohibidos del snapshot sobre el tamaño o alcance de las papitas del Maxi Family.',
      'Responde únicamente JSON con el schema solicitado.',
    ].join(' ');
  }

  private redactedInput(input: SofiaAIAnalysisInput) {
    const redactPersonal = this.configService.get<boolean>('SOFIA_AI_REDACT_PERSONAL_DATA') !== false;
    return {
      conversationId: redactPersonal ? 'redacted' : input.conversationId,
      customerMessage: redactPersonal ? this.redactPhoneLikeText(input.customerMessage) : input.customerMessage,
      normalizedMessage: input.normalizedMessage,
      currentDraftSnapshot: input.currentDraftSnapshot,
      availableOffersSnapshot: input.availableOffersSnapshot,
      availableProductsSnapshot: input.availableProductsSnapshot,
      paymentOptionsSnapshot: input.paymentOptionsSnapshot,
      businessRulesSnapshot: input.businessRulesSnapshot,
      recentMessagesSummary: redactPersonal ? null : input.recentMessagesSummary,
      mode: input.mode,
      schema: {
        intent: 'Sofia intent enum',
        confidence: '0..1',
        extractedItems: [{ productId: 'optional existing product id only', name: 'existing product name only', quantity: 1 }],
        missingFields: ['string'],
        suggestedReply: 'string',
        suggestedUpsell: 'string|null',
        shouldCreateDraft: false,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        shouldHandoff: false,
        handoffReason: 'string|null',
        safetyFlags: ['string'],
        forbiddenClaimsDetected: ['string'],
      },
    };
  }

  private redactPhoneLikeText(value: string) {
    return value.replace(/\+?\d[\d\s-]{6,}\d/g, '[telefono-redactado]');
  }

  private parseStructuredOutput(input: SofiaAIAnalysisInput, content: string): SofiaAIAnalysisOutput {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error('AI_INVALID_RESPONSE:JSON');
    }

    const intent = VALID_INTENTS.includes(parsed.intent as SofiaAIIntent) ? (parsed.intent as SofiaAIIntent) : input.ruleIntent;
    const confidence = Math.max(0, Math.min(Number(parsed.confidence ?? input.ruleConfidence), 1));
    const rawItems = Array.isArray(parsed.extractedItems) ? parsed.extractedItems : [];
    const extractedItems = rawItems
      .map((item): SofiaAIExtractedItem | null => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name : '';
        const quantity = Number(record.quantity ?? 1);
        if (!name || quantity <= 0) return null;
        return {
          productId: typeof record.productId === 'string' ? record.productId : null,
          name,
          quantity,
          unitPrice: record.unitPrice == null ? null : Number(record.unitPrice),
        };
      })
      .filter((item): item is SofiaAIExtractedItem => Boolean(item));

    return {
      provider: this.provider,
      mode: input.mode,
      intent,
      confidence,
      extractedItems,
      missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.map(String) : [],
      suggestedReply: typeof parsed.suggestedReply === 'string' ? parsed.suggestedReply : null,
      suggestedUpsell: typeof parsed.suggestedUpsell === 'string' ? parsed.suggestedUpsell : null,
      shouldCreateDraft: parsed.shouldCreateDraft === true,
      shouldCreateOrder: parsed.shouldCreateOrder === true,
      shouldGeneratePaymentLink: parsed.shouldGeneratePaymentLink === true,
      shouldHandoff: parsed.shouldHandoff === true,
      handoffReason: typeof parsed.handoffReason === 'string' ? parsed.handoffReason : null,
      safetyFlags: Array.isArray(parsed.safetyFlags) ? parsed.safetyFlags.map(String) : [],
      forbiddenClaimsDetected: Array.isArray(parsed.forbiddenClaimsDetected) ? parsed.forbiddenClaimsDetected.map(String) : [],
      fallbackUsed: false,
      diagnostics: ['AI_PROVIDER_USED:deepseek'],
    };
  }
}
