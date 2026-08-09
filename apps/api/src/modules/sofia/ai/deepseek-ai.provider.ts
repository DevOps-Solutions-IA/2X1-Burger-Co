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
import { SofiaPromptService } from '../prompt/sofia-prompt.service';
import type { CommercialFactEnvelope } from '../commercial/response/commercial-response.types';

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

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 1_000;
const MAX_CATALOG_ITEMS = 50;

type DeepSeekPayload = { choices?: Array<{ message?: { content?: string } }> };

class DeepSeekRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'DeepSeekRequestError';
  }
}

@Injectable()
export class DeepSeekAIProvider extends SofiaAIProviderAdapter {
  readonly provider = 'deepseek' as const;

  constructor(
    private readonly configService: ConfigService,
    private readonly promptService: SofiaPromptService,
  ) {
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

    const prompt = await this.promptService.getCompiledSystemPrompt();
    const userPayload = this.redactedInput(input);
    const timeoutMs = this.timeoutMs();
    const maxRetries = this.maxRetries();
    const maxTokens = this.configService.get<number>('DEEPSEEK_MAX_TOKENS') ?? 700;
    const model = this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-v4-flash';
    try {
      const payload = await this.requestJson<DeepSeekPayload>(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
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
        },
        { timeoutMs, maxRetries },
      );
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new DeepSeekRequestError('DEEPSEEK_EMPTY_RESPONSE', false);
      return this.parseStructuredOutput(input, content);
    } catch (error) {
      return {
        ...this.rulesOutput(input, [`AI_PROVIDER_FALLBACK:${this.errorCode(error)}`]),
        provider: this.provider,
        fallbackUsed: true,
      };
    }
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
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    const baseUrl = this.configService.get<string>('DEEPSEEK_BASE_URL');
    const configured = Boolean(apiKey && baseUrl);
    if (!enabled) {
      return {
        provider: this.provider,
        configured,
        enabled,
        ok: false,
        message: 'DeepSeek deshabilitado; no se afirma salud del proveedor.',
      };
    }
    if (!apiKey || !baseUrl) {
      return {
        provider: this.provider,
        configured: false,
        enabled,
        ok: false,
        message: 'DeepSeek habilitado sin configuración completa.',
      };
    }

    try {
      await this.requestJson<unknown>(
        `${baseUrl.replace(/\/$/, '')}/models`,
        { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
        { timeoutMs: Math.min(this.timeoutMs(), 3_000), maxRetries: 0 },
      );
      return {
        provider: this.provider,
        configured,
        enabled,
        ok: true,
        message: 'DeepSeek respondió correctamente al sondeo acotado.',
      };
    } catch (error) {
      return {
        provider: this.provider,
        configured,
        enabled,
        ok: false,
        message: `DeepSeek no saludable: ${this.errorCode(error)}.`,
      };
    }
  }

  async composeCommercialResponse(envelope: CommercialFactEnvelope): Promise<string | null> {
    if (!this.isEnabled()) return null;
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    const baseUrl = this.configService.get<string>('DEEPSEEK_BASE_URL');
    if (!apiKey || !baseUrl) return null;

    try {
      const payload = await this.requestJson<DeepSeekPayload>(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-v4-flash',
            max_tokens: 220,
            temperature: 0.55,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: [
                  'Eres un compositor de lenguaje, no un agente ni un motor de decisiones.',
                  'Devuelve JSON {"text":"..."} con una respuesta breve y natural en es-CO.',
                  'Usa exclusivamente los hechos y opciones del sobre. No agregues precios, productos, descuentos, pagos, estados, ETA ni acciones.',
                  'No llames herramientas, no interpretes intención y no alteres ningún hecho.',
                ].join(' '),
              },
              { role: 'user', content: JSON.stringify(this.commercialInput(envelope)) },
            ],
          }),
        },
        { timeoutMs: this.timeoutMs(), maxRetries: this.maxRetries() },
      );
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as { text?: unknown };
      return typeof parsed.text === 'string' ? parsed.text : null;
    } catch {
      // Returning null delegates to the deterministic, fact-validated commercial templates.
      return null;
    }
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    policy: { timeoutMs: number; maxRetries: number },
  ): Promise<T> {
    let lastError: DeepSeekRequestError = new DeepSeekRequestError('DEEPSEEK_REQUEST_FAILED', false);

    for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          throw new DeepSeekRequestError(
            `DEEPSEEK_HTTP_${response.status}`,
            response.status === 408 || response.status === 429 || response.status >= 500,
          );
        }
        try {
          return (await response.json()) as T;
        } catch {
          throw new DeepSeekRequestError('DEEPSEEK_INVALID_JSON', false);
        }
      } catch (error) {
        lastError = this.normalizeRequestError(error);
      } finally {
        clearTimeout(timer);
      }

      if (!lastError.retryable || attempt === policy.maxRetries) break;
      await this.sleep(this.retryDelayMs(attempt));
    }

    throw lastError;
  }

  private normalizeRequestError(error: unknown): DeepSeekRequestError {
    if (error instanceof DeepSeekRequestError) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new DeepSeekRequestError('DEEPSEEK_TIMEOUT', true);
    }
    if (error instanceof TypeError) {
      return new DeepSeekRequestError('DEEPSEEK_NETWORK_ERROR', true);
    }
    return new DeepSeekRequestError('DEEPSEEK_REQUEST_FAILED', false);
  }

  private errorCode(error: unknown) {
    return error instanceof DeepSeekRequestError ? error.code : 'DEEPSEEK_RESPONSE_REJECTED';
  }

  private timeoutMs() {
    const configured = Number(this.configService.get<number>('DEEPSEEK_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    return Math.max(1, Math.min(Number.isFinite(configured) ? configured : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
  }

  private maxRetries() {
    const configured = Number(this.configService.get<number>('DEEPSEEK_MAX_RETRIES') ?? 2);
    return Math.max(0, Math.min(Number.isFinite(configured) ? Math.floor(configured) : 2, MAX_RETRIES));
  }

  private retryDelayMs(attempt: number) {
    const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 4)));
    return Math.min(exponential + jitter, RETRY_MAX_DELAY_MS);
  }

  private async sleep(delayMs: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
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

  private redactedInput(input: SofiaAIAnalysisInput) {
    if (!this.shouldRedactPersonalData()) {
      return {
        conversationId: input.conversationId,
        customerMessage: input.customerMessage,
        normalizedMessage: input.normalizedMessage,
        currentDraftSnapshot: input.currentDraftSnapshot,
        availableOffersSnapshot: input.availableOffersSnapshot,
        availableProductsSnapshot: input.availableProductsSnapshot,
        paymentOptionsSnapshot: input.paymentOptionsSnapshot,
        businessRulesSnapshot: input.businessRulesSnapshot,
        recentMessagesSummary: input.recentMessagesSummary,
        mode: input.mode,
        schema: this.responseSchema(false),
      };
    }

    const normalizedMessage = this.normalizeForMatching(input.normalizedMessage);
    const products = input.availableProductsSnapshot.slice(0, MAX_CATALOG_ITEMS);
    const offers = input.availableOffersSnapshot.slice(0, MAX_CATALOG_ITEMS);

    return {
      privacyMode: 'PERSONAL_DATA_REDACTED',
      customerSignal: {
        ruleIntent: input.ruleIntent,
        ruleConfidence: this.boundedNumber(input.ruleConfidence, 0, 1),
        messageLength: this.lengthBucket(input.customerMessage),
        semantics: this.semanticSignals(normalizedMessage),
        matchedProductRefs: products
          .map((product, index) => (this.matchesDomainTerm(normalizedMessage, [product.name, product.code]) ? `product-${index + 1}` : null))
          .filter((reference): reference is string => reference !== null),
        matchedOfferRefs: offers
          .map((offer, index) => (this.matchesDomainTerm(normalizedMessage, [offer.name, offer.slug]) ? `offer-${index + 1}` : null))
          .filter((reference): reference is string => reference !== null),
      },
      draftState: this.redactedDraftState(input.currentDraftSnapshot),
      availableOffers: offers.map((offer, index) => ({
        ref: `offer-${index + 1}`,
        linkedProductRef: this.linkedProductRef(offer.linkedProductId, products),
        price: this.boundedNumber(offer.price, 0, Number.MAX_SAFE_INTEGER),
      })),
      availableProducts: products.map((product, index) => ({
        ref: `product-${index + 1}`,
        price: this.boundedNumber(product.price, 0, Number.MAX_SAFE_INTEGER),
        available: product.available === true,
        categoryKnown: Boolean(product.categoryName),
      })),
      paymentState: {
        optionsConfigured: input.paymentOptionsSnapshot != null,
        aiCannotMarkPaid: input.businessRulesSnapshot.noPaidFromAi === true,
      },
      businessRules: {
        maxiFamilyPolicyConfigured: input.businessRulesSnapshot.maxiFamilyCopy.length > 0,
        forbiddenMaxiFamilyClaimCount: input.businessRulesSnapshot.forbiddenMaxiFamilyClaims.length,
        noPaidFromAi: input.businessRulesSnapshot.noPaidFromAi === true,
        noInventedProducts: input.businessRulesSnapshot.noInventedProducts === true,
        noInventedPrices: input.businessRulesSnapshot.noInventedPrices === true,
      },
      mode: input.mode,
      schema: this.responseSchema(true),
    };
  }

  private commercialInput(envelope: CommercialFactEnvelope) {
    if (!this.shouldRedactPersonalData()) return envelope;

    return {
      privacyMode: 'PERSONAL_DATA_REDACTED',
      responsePurpose: envelope.responsePurpose,
      allowedFacts: {
        draftOnly: envelope.allowedFacts.includes('DRAFT_ONLY'),
        noOperationalMutation: envelope.allowedFacts.includes('NO_OPERATIONAL_MUTATION'),
        noDiscountAvailable: envelope.allowedFacts.includes('NO_DISCOUNT_AVAILABLE'),
        draftRejected: envelope.allowedFacts.includes('DRAFT_REJECTED'),
      },
      allowedOptions: envelope.allowedOptions,
      customerContextSafe: { preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' },
      fulfillment: envelope.fulfillment,
      paymentOptions: envelope.paymentOptions,
      items: envelope.items.slice(0, MAX_CATALOG_ITEMS).map((item, index) => ({
        ref: `item-${index + 1}`,
        quantity: this.boundedNumber(item.quantity, 0, 100),
        unitPrice: this.boundedNumber(item.unitPrice, 0, Number.MAX_SAFE_INTEGER),
        modifierCount: Math.min(item.modifiers.length, MAX_CATALOG_ITEMS),
        available: item.available,
      })),
      subtotal: this.nullableMoney(envelope.subtotal),
      deliveryFee: this.nullableMoney(envelope.deliveryFee),
      total: this.nullableMoney(envelope.total),
      addressProvided: envelope.addressSafe !== null,
      missingFieldCount: Math.min(envelope.missingFields.length, MAX_CATALOG_ITEMS),
      confirmationRequired: envelope.confirmationRequired,
      handoffRequired: envelope.handoffRequired,
      forbiddenClaimCount: Math.min(envelope.forbiddenClaims.length, MAX_CATALOG_ITEMS),
    };
  }

  private shouldRedactPersonalData() {
    return this.configService.get<boolean>('SOFIA_AI_REDACT_PERSONAL_DATA') !== false;
  }

  private responseSchema(redacted: boolean) {
    return {
      intent: 'Sofia intent enum',
      confidence: '0..1',
      extractedItems: redacted
        ? [{ productRef: 'optional available product ref only', quantity: 1 }]
        : [{ productId: 'optional existing product id only', name: 'existing product name only', quantity: 1 }],
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
    };
  }

  private semanticSignals(normalizedMessage: string) {
    return {
      greeting: /\b(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(normalizedMessage),
      asksMenu: /\b(menu|carta|productos|opciones)\b/.test(normalizedMessage),
      asksCombo: /\b(combo|combos|maxi family)\b/.test(normalizedMessage),
      asksPrice: /\b(precio|cuanto|cuesta|vale)\b/.test(normalizedMessage),
      orderAction: /\b(quiero|deme|dame|pedido|agrega|anade|quita|elimina)\b/.test(normalizedMessage),
      asksDelivery: /\b(domicilio|delivery|envio|entrega)\b/.test(normalizedMessage),
      providesAddress: /\b(direccion|calle|carrera|avenida|diagonal|transversal)\b/.test(normalizedMessage),
      providesName: /\b(me llamo|mi nombre|soy)\b/.test(normalizedMessage),
      mentionsCash: /\b(efectivo|contraentrega|al recibir)\b/.test(normalizedMessage),
      confirms: /\b(confirmo|confirmar|correcto|si deseo)\b/.test(normalizedMessage),
      cancels: /\b(cancelar|cancelo|no quiero)\b/.test(normalizedMessage),
      requestsHuman: /\b(humano|asesor|persona|agente)\b/.test(normalizedMessage),
      hasExplicitQuantity: /\b(?:[1-9]|[1-9]\d|100)\b/.test(normalizedMessage),
    };
  }

  private normalizeForMatching(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private matchesDomainTerm(normalizedMessage: string, candidates: Array<string | null | undefined>) {
    return candidates.some((candidate) => {
      const normalizedCandidate = this.normalizeForMatching(candidate ?? '').trim();
      return normalizedCandidate.length >= 3 && normalizedMessage.includes(normalizedCandidate);
    });
  }

  private redactedDraftState(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return { present: snapshot != null, itemCount: 0, hasDeliveryAddress: false, hasCustomerName: false, hasCustomerPhone: false };
    }
    const draft = snapshot as Record<string, unknown>;
    return {
      present: true,
      itemCount: Math.min(Array.isArray(draft.items) ? draft.items.length : 0, MAX_CATALOG_ITEMS),
      hasDeliveryAddress: draft.hasDeliveryAddress === true || Boolean(draft.deliveryAddress),
      hasCustomerName: draft.hasCustomerName === true || Boolean(draft.customerName),
      hasCustomerPhone: draft.hasCustomerPhone === true || Boolean(draft.customerPhone),
    };
  }

  private linkedProductRef(linkedProductId: string, products: SofiaAIAnalysisInput['availableProductsSnapshot']) {
    const index = products.findIndex((product) => product.id === linkedProductId);
    return index >= 0 ? `product-${index + 1}` : null;
  }

  private boundedNumber(value: number, minimum: number, maximum: number) {
    return Number.isFinite(value) ? Math.max(minimum, Math.min(value, maximum)) : minimum;
  }

  private nullableMoney(value: number | null) {
    return value === null ? null : this.boundedNumber(value, 0, Number.MAX_SAFE_INTEGER);
  }

  private lengthBucket(value: string) {
    if (value.length === 0) return 'EMPTY';
    if (value.length <= 40) return 'SHORT';
    if (value.length <= 160) return 'MEDIUM';
    return 'LONG';
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
    const redactPersonalData = this.shouldRedactPersonalData();
    const extractedItems = rawItems
      .map((item): SofiaAIExtractedItem | null => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const referencedProduct = redactPersonalData ? this.productFromRef(record.productRef, input.availableProductsSnapshot) : null;
        const name = referencedProduct?.name ?? (!redactPersonalData && typeof record.name === 'string' ? record.name : '');
        const quantity = Number(record.quantity ?? 1);
        if (!name || quantity <= 0) return null;
        return {
          productId: referencedProduct?.id ?? (!redactPersonalData && typeof record.productId === 'string' ? record.productId : null),
          name,
          quantity,
          unitPrice: referencedProduct?.price ?? (!redactPersonalData && record.unitPrice != null ? Number(record.unitPrice) : null),
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

  private productFromRef(reference: unknown, products: SofiaAIAnalysisInput['availableProductsSnapshot']) {
    if (typeof reference !== 'string') return null;
    const match = /^product-([1-9]\d*)$/.exec(reference);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    return index >= 0 && index < Math.min(products.length, MAX_CATALOG_ITEMS) ? products[index] : null;
  }
}
