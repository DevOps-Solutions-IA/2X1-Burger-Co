import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  AUDIT_COMMAND_SERVICE,
  CATALOG_READ_SERVICE,
  CUSTOMER_RESOLUTION_SERVICE,
  DELIVERY_QUOTE_SERVICE,
  ORDER_CREATION_SERVICE,
  PRODUCT_AVAILABILITY_SERVICE,
  RECIPE_AVAILABILITY_SERVICE,
  type AuditCommandService,
  type CatalogProductDto,
  type CatalogReadService,
  type CustomerResolutionService,
  type DeliveryQuoteService,
  type OrderCreationService,
  type ProductAvailabilityService,
  type RecipeAvailabilityService,
} from '../../../application/contracts/sofia-domain-contracts';
import { commercialDraftHash } from './commercial-draft-hash';
import { CommercialIntentEngine, normalizeCommercialText } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { COMMERCIAL_REPOSITORY, type CommercialRepository } from './commercial.repository';
import type { CommercialConversationState, CommercialMessageCommand, CommercialTurnResult, LastQuestionPurpose } from './commercial.types';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import type { CommercialFactEnvelope, CommercialResponsePurpose } from './response/commercial-response.types';

const emptyState = (conversationId: string): CommercialConversationState => ({
  schemaVersion: 4, conversationId, customerId: null, intent: 'UNKNOWN', items: [], fulfillment: null, address: null, addressConfirmed: false, location: null,
  paymentPreference: 'UNKNOWN', paymentReadiness: 'PAYMENT_UNRESOLVED', subtotal: null, deliveryFee: null, total: null, deliveryQuoteAuditId: null,
  deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [], draftId: null, draftVersion: null,
  draftHash: null, confirmationState: 'NONE',
  missingFields: [], ambiguities: [], confidence: 'LOW', handoffState: 'SOFIA_ACTIVE', consentState: 'SERVICE',
  domainErrors: [], lastQuestionPurpose: null, lastResolvedIntent: null, expiresAt: null,
});

@Injectable()
export class CommercialCheckoutService {
  constructor(
    private readonly intents: CommercialIntentEngine,
    private readonly policy: CommercialPolicyService,
    private readonly metrics: CommercialMetricsService,
    private readonly responses: CommercialResponseComposer,
    @Inject(COMMERCIAL_REPOSITORY) private readonly repository: CommercialRepository,
    @Inject(CATALOG_READ_SERVICE) private readonly catalog: CatalogReadService,
    @Inject(PRODUCT_AVAILABILITY_SERVICE) private readonly productAvailability: ProductAvailabilityService,
    @Inject(RECIPE_AVAILABILITY_SERVICE) private readonly recipeAvailability: RecipeAvailabilityService,
    @Inject(CUSTOMER_RESOLUTION_SERVICE) private readonly customers: CustomerResolutionService,
    @Inject(DELIVERY_QUOTE_SERVICE) private readonly deliveryQuotes: DeliveryQuoteService,
    @Inject(AUDIT_COMMAND_SERVICE) private readonly audit: AuditCommandService,
    @Inject(ORDER_CREATION_SERVICE) private readonly orderCreation: OrderCreationService,
  ) {}

  async shouldHandle(conversationId: string, message: string) {
    const existing = await this.repository.loadState(conversationId);
    if (existing) return true;
    const normalized = normalizeCommercialText(message);
    if (/lo mismo de|pedido anterior|que trae|menu|carta|que tienen|\bmaxi\b|doble todo|foto|imagen|queja|reclamo|me llego mal/.test(normalized)) return false;
    const parsed = this.intents.interpret(message, null);
    const transactionalContext = parsed.fulfillment !== null
      || parsed.paymentPreference !== 'UNKNOWN'
      || parsed.modifiers.length > 0
      || /(?:carrera|calle|avenida|cra|cl)\s+/.test(normalized);
    return transactionalContext && ['PURCHASE', 'CHANGE_ORDER', 'CONFIRM'].includes(parsed.intent);
  }

  async process(command: CommercialMessageCommand): Promise<CommercialTurnResult> {
    const previous = await this.repository.loadState(command.conversationId) ?? emptyState(command.conversationId);
    const parsed = this.intents.interpret(command.message, previous.lastQuestionPurpose);
    const state: CommercialConversationState = { ...previous, intent: parsed.intent, confidence: parsed.confidence, ambiguities: [], domainErrors: [], lastResolvedIntent: parsed.intent !== 'UNKNOWN' ? parsed.intent : previous.lastResolvedIntent, location: command.location ?? previous.location };

    if (parsed.adversarial || parsed.intent === 'ASK_HUMAN') return this.handoff(state, command, 'SOFIA_UNTRUSTED_OR_HUMAN_REQUEST');
    if (/descuento|cupon|rebaja/.test(parsed.normalized)) {
      await this.persistAndAudit(state, command, 'SOFIA_DISCOUNT_NOT_AUTHORIZED');
      return this.respond(state, 'DISCOUNT_UNAVAILABLE', 'NO_ACTION', { allowedFacts: ['NO_DISCOUNT_AVAILABLE'] });
    }
    if (/como siempre|pero distinto|lo que tu quieras|ponme lo que/.test(parsed.normalized)) {
      return this.handoff(state, command, 'SOFIA_COMMERCIAL_AMBIGUITY_REQUIRES_HUMAN');
    }
    if (parsed.intent === 'REJECT') {
      state.confirmationState = 'REJECTED';
      state.lastQuestionPurpose = null;
      await this.persistAndAudit(state, command, 'SOFIA_COMMERCIAL_CONFIRMATION_REJECTED');
      return this.respond(state, 'CONFIRM_DRAFT', 'NO_ACTION', { confirmationRequired: false, allowedFacts: ['DRAFT_REJECTED'] });
    }
    if (parsed.affirmative && previous.confirmationState === 'CONFIRMED') {
      await this.persistAndAudit(state, command, 'SOFIA_DRAFT_CONFIRMATION_REPLAY');
      return this.respond(state, state.fulfillment === 'DELIVERY' ? 'DELIVERY_CONFIRMED' : 'TAKEAWAY_CONFIRMED', 'DRAFT_CONFIRMED');
    }

    if (!state.customerId) {
      try {
        state.customerId = (await this.customers.resolve({ phone: command.phone, displayName: command.displayName, idempotencyKey: `commercial:${command.conversationId}`, actor: command.actor })).customerId;
      } catch { return this.dependencyFailure(state, command, 'CRM_UNAVAILABLE'); }
    }

    if (parsed.fulfillment) {
      if (state.fulfillment && state.fulfillment !== parsed.fulfillment) this.invalidateDraft(state);
      state.fulfillment = parsed.fulfillment;
      if (parsed.fulfillment === 'TAKEAWAY') {
        state.address = null;
        state.addressConfirmed = false;
        state.deliveryFee = 0;
        state.deliveryQuoteAuditId = null;
        state.deliveryQuoteVersion = null;
        state.deliveryQuoteExpiresAt = null;
      }
    }
    if (parsed.paymentPreference !== 'UNKNOWN') state.paymentPreference = parsed.paymentPreference;
    if (parsed.address) {
      state.address = parsed.address;
      state.addressConfirmed = true;
    }

    try { this.policy.validatePayment(state.fulfillment, state.paymentPreference); }
    catch { state.paymentPreference = 'UNKNOWN'; state.ambiguities.push('paymentPreference'); }
    state.paymentReadiness = state.paymentPreference === 'ONLINE'
      ? 'PAYMENT_READY_ONLINE'
      : state.paymentPreference === 'CASH_ON_DELIVERY'
        ? 'PAYMENT_COD'
        : state.paymentPreference === 'PAY_AT_PICKUP'
          ? 'PAYMENT_AT_PICKUP'
          : 'PAYMENT_UNRESOLVED';

    const products = await this.resolveProducts(command.message);
    if (products === 'AMBIGUOUS') state.ambiguities.push('product');
    else if (products.length) {
      const normalized = normalizeCommercialText(command.message);
      const nextItems = products.map((product, index) => ({
        productId: product.id,
        code: product.code,
        name: product.name,
        quantity: this.quantityForProduct(normalized, product, products.length === 1 ? parsed.quantity : null),
        unitPrice: product.persistedPrice,
        modifiers: index === 0 ? parsed.modifiers : [],
      }));
      const mentioned = new Set(nextItems.map((item) => item.productId));
      state.items = [...state.items.filter((item) => !mentioned.has(item.productId)), ...nextItems];
      this.invalidateDraft(state);
    } else if (state.items.length === 1 && parsed.quantity) {
      state.items = [{ ...state.items[0]!, quantity: parsed.quantity }];
      this.invalidateDraft(state);
    } else if (state.items.length && parsed.clearModifiers) {
      state.items = [{ ...state.items[0]!, modifiers: [] }, ...state.items.slice(1)];
      this.invalidateDraft(state);
    } else if (state.items.length && parsed.modifiers.length) {
      state.items = [{ ...state.items[0]!, modifiers: parsed.modifiers }, ...state.items.slice(1)];
      this.invalidateDraft(state);
    }

    const identityContextOnly = /^(?:soy|mi nombre es|me llamo)\b/.test(parsed.normalized);
    if (parsed.intent === 'UNKNOWN' && parsed.paymentPreference === 'UNKNOWN' && !parsed.fulfillment && !parsed.address && !parsed.affirmative && !parsed.negative && !identityContextOnly) {
      return this.handoff(state, command, 'SOFIA_UNKNOWN_TRANSACTIONAL_REQUEST');
    }

    state.missingFields = this.policy.missing(state);
    if (state.ambiguities.length) state.missingFields = [...new Set([...state.missingFields, ...state.ambiguities])];

    if (parsed.intent === 'CONFIRM') return this.confirm(state, command);
    if (state.missingFields.length) {
      state.lastQuestionPurpose = this.policy.questionPurpose(state.missingFields);
      state.confirmationState = 'NONE';
      await this.persistAndAudit(state, command, state.confidence === 'LOW' ? 'SOFIA_COMMERCIAL_INTENT_AMBIGUOUS' : 'SOFIA_COMMERCIAL_INTENT_RESOLVED');
      return this.respond(state, this.responsePurpose(state.lastQuestionPurpose, state.ambiguities), 'ASK_MISSING');
    }

    const prepared = await this.prepareDraft(state, command);
    prepared.lastQuestionPurpose = 'CONFIRM_ORDER';
    prepared.confirmationState = 'PENDING';
    await this.persistAndAudit(prepared, command, prepared.draftVersion === 1 ? 'SOFIA_DRAFT_CREATED' : 'SOFIA_DRAFT_UPDATED');
    return this.respond(prepared, 'SUMMARIZE_DRAFT', 'READY_TO_CONFIRM');
  }

  private async resolveProducts(message: string): Promise<CatalogProductDto[] | 'AMBIGUOUS'> {
    try {
      const normalized = normalizeCommercialText(message);
      const products = await this.catalog.listActive();
      const scored = products.map((product) => {
        const name = normalizeCommercialText(product.name);
        const aliases = [name, normalizeCommercialText(product.code), ...(name.includes('2x1') ? ['2x1', 'combo 2x1', 'promo 2x1'] : [])];
        return { product, score: Math.max(...aliases.map((alias) => normalized.includes(alias) ? alias.length : 0)) };
      }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
      if (!scored.length) return [];
      const explicitProducts = scored.filter((entry) => normalized.includes(normalizeCommercialText(entry.product.name)));
      if (explicitProducts.length > 1) return [...new Map(explicitProducts.map((entry) => [entry.product.id, entry.product])).values()];
      if (scored[1] && scored[1].score === scored[0]!.score && scored[1].product.persistedPrice !== scored[0]!.product.persistedPrice) return 'AMBIGUOUS';
      const exactMatches = scored.filter((entry) => entry.score >= Math.min(normalizeCommercialText(entry.product.name).length, 4));
      return [...new Map(exactMatches.map((entry) => [entry.product.id, entry.product])).values()];
    } catch { this.metrics.increment('catalog_failure'); throw new ServiceUnavailableException({ code: 'SOFIA_CATALOG_UNAVAILABLE' }); }
  }

  private quantityForProduct(normalized: string, product: CatalogProductDto, fallback: number | null) {
    const aliases = [normalizeCommercialText(product.name), normalizeCommercialText(product.code)].filter(Boolean);
    for (const alias of aliases) {
      const at = normalized.indexOf(alias);
      if (at < 0) continue;
      const prefix = normalized.slice(Math.max(0, at - 24), at);
      const token = prefix.match(/(?:^|\s)(\d+|un|una|uno|dos|tres|cuatro|cinco|seis)\s*$/)?.[1];
      if (token) return Number(token) || ({ un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }[token] ?? 1);
    }
    return fallback ?? 1;
  }

  private async prepareDraft(state: CommercialConversationState, command: CommercialMessageCommand) {
    const availability = await this.validateAvailability(state);
    const subtotal = state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let deliveryFee = 0, deliveryQuoteAuditId: string | null = null, deliveryQuoteVersion: number | null = null, deliveryQuoteExpiresAt: Date | null = null;
    if (state.fulfillment === 'DELIVERY') {
      const quote = await this.deliveryQuotes.quote({
        addressText: state.address!,
        latitude: state.location?.latitude,
        longitude: state.location?.longitude,
        orderSubtotal: subtotal,
        actor: command.actor,
      });
      if (!quote.canCheckout || quote.finalFee === null || !quote.auditId) throw new BadRequestException({ code: 'SOFIA_DELIVERY_QUOTE_REQUIRED', reasonCode: quote.reasonCode });
      deliveryFee = quote.finalFee; deliveryQuoteAuditId = quote.auditId;
      deliveryQuoteVersion = Number(quote.calculationVersion.match(/v(\d+)$/)?.[1] ?? 0) || null;
      deliveryQuoteExpiresAt = new Date(Date.now() + 15 * 60_000);
    }
    const version = state.draftVersion ? state.draftVersion + 1 : 1;
    const saved = await this.repository.saveDraft({ draftId: state.draftId ?? undefined, conversationId: state.conversationId, customerId: state.customerId, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, version, items: state.items, subtotal, deliveryFee, total: subtotal + deliveryFee, address: state.address, addressConfirmed: state.addressConfirmed, deliveryQuoteAuditId, deliveryQuoteVersion, deliveryQuoteExpiresAt, availabilitySnapshot: availability });
    return {
      ...state,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliveryQuoteAuditId,
      deliveryQuoteVersion,
      deliveryQuoteExpiresAt: deliveryQuoteExpiresAt?.toISOString() ?? null,
      availabilitySnapshot: availability,
      draftId: saved.id,
      draftVersion: saved.version,
      draftHash: saved.draftHash,
      expiresAt: saved.expiresAt.toISOString(),
      domainErrors: [],
    };
  }

  private async validateAvailability(state: CommercialConversationState) {
    return Promise.all(state.items.map(async (item) => {
      const product = await this.catalog.getActiveById(item.productId);
      if (product.persistedPrice !== item.unitPrice) throw new BadRequestException({ code: 'SOFIA_PRICE_CHANGED', productId: item.productId });
      const result = product.kind === 'PREPARED' ? await this.recipeAvailability.check({ productId: item.productId, quantity: item.quantity }) : await this.productAvailability.check({ productId: item.productId, quantity: item.quantity });
      if (!result.available) throw new BadRequestException({ code: 'SOFIA_PRODUCT_UNAVAILABLE', reasonCode: result.reasonCode });
      for (const modifier of item.modifiers.filter((entry) => entry.kind === 'REMOVE')) {
        const ingredients = (result as { recipeIngredients?: Array<{ ingredientId: string; name: string }> }).recipeIngredients ?? [];
        if (!ingredients.some((ingredient) => normalizeCommercialText(ingredient.name).includes(normalizeCommercialText(modifier.name)))) throw new BadRequestException({ code: 'SOFIA_MODIFIER_UNSUPPORTED', modifier: modifier.name });
      }
      if (item.modifiers.some((entry) => entry.kind === 'ADD')) throw new BadRequestException({ code: 'SOFIA_MODIFIER_UNSUPPORTED' });
      return { productId: item.productId, quantity: item.quantity, checkedAt: result.checkedAt, reasonCode: result.reasonCode };
    }));
  }

  private async confirm(state: CommercialConversationState, command: CommercialMessageCommand): Promise<CommercialTurnResult> {
    if (state.lastQuestionPurpose !== 'CONFIRM_ORDER' || !state.draftId || !state.draftVersion || !state.draftHash || !state.expiresAt) return this.handoff(state, command, 'SOFIA_CONTEXTUAL_CONFIRMATION_INVALID');
    if (new Date(state.expiresAt) <= new Date() || (state.fulfillment === 'DELIVERY' && (!state.deliveryQuoteExpiresAt || new Date(state.deliveryQuoteExpiresAt) <= new Date()))) {
      state.confirmationState = 'EXPIRED';
      const refreshed = await this.prepareDraft(state, command);
      refreshed.confirmationState = 'PENDING';
      refreshed.lastQuestionPurpose = 'CONFIRM_ORDER';
      await this.persistAndAudit(refreshed, command, 'SOFIA_DRAFT_EXPIRED_REFRESHED');
      return this.respond(refreshed, 'QUOTE_EXPIRED', 'READY_TO_CONFIRM');
    }
    try {
      await this.validateAvailability(state);
    } catch (error) {
      if (error instanceof BadRequestException && (error.getResponse() as { code?: string }).code === 'SOFIA_PRICE_CHANGED') {
        for (const item of state.items) item.unitPrice = (await this.catalog.getActiveById(item.productId)).persistedPrice;
        const refreshed = await this.prepareDraft(state, command);
        refreshed.confirmationState = 'PENDING';
        refreshed.lastQuestionPurpose = 'CONFIRM_ORDER';
        await this.persistAndAudit(refreshed, command, 'SOFIA_DRAFT_PRICE_REFRESHED');
        return this.respond(refreshed, 'PRICE_CHANGED', 'READY_TO_CONFIRM');
      }
      throw error;
    }
    const confirmationHash = commercialDraftHash({ draftId: state.draftId, version: state.draftVersion, draftHash: state.draftHash, customerId: state.customerId, conversationId: state.conversationId });
    await this.repository.confirmDraft({ draftId: state.draftId, expectedVersion: state.draftVersion, expectedHash: state.draftHash, confirmationHash });
    state.confirmationState = 'CONFIRMED'; state.lastQuestionPurpose = null;
    await this.persistAndAudit(state, command, 'SOFIA_DRAFT_CONFIRMED');
    // Governed bridge to the canonical order authority: SecureCommand(SOFIA_CREATE_ORDER) ->
    // canonical OrderCheckout -> canonical OrderTicket. Fails closed by design in every
    // environment today (SOFIA_CREATE_ORDER remains an OWNER_ACTIVATION_GATE, `enabled: false` in
    // command-handler.registry.ts) -- the failure is intentionally swallowed here: draft
    // confirmation itself is never rolled back, no operational claim is made to the customer
    // (factEnvelope keeps allowedFacts: ['DRAFT_ONLY', 'NO_OPERATIONAL_MUTATION'] unchanged below),
    // and SecureCommand still leaves a durable, audited attempt record either way.
    try {
      await this.orderCreation.createFromSofiaDraft({
        draftId: state.draftId,
        idempotencyKey: `sofia-draft:${state.draftId}`,
        actor: command.actor,
      });
    } catch {
      // Intentionally swallowed: see comment above. No user-facing claim changes.
    }
    return this.respond(state, state.fulfillment === 'DELIVERY' ? 'DELIVERY_CONFIRMED' : 'TAKEAWAY_CONFIRMED', 'DRAFT_CONFIRMED');
  }

  private responsePurpose(purpose: LastQuestionPurpose, ambiguities: string[]): CommercialResponsePurpose {
    if (purpose === 'PRODUCT') return ambiguities.includes('product') ? 'CLARIFY_PRODUCT' : 'ASK_PRODUCT';
    if (purpose === 'FULFILLMENT') return 'ASK_FULFILLMENT';
    if (purpose === 'PAYMENT') return ambiguities.includes('paymentPreference') ? 'CLARIFY_PAYMENT' : 'ASK_PAYMENT';
    if (purpose === 'DELIVERY_ADDRESS') return 'ASK_ADDRESS';
    return 'CONFIRM_DRAFT';
  }

  private factEnvelope(
    state: CommercialConversationState,
    responsePurpose: CommercialResponsePurpose,
    overrides: Partial<CommercialFactEnvelope> = {},
  ): CommercialFactEnvelope {
    const paymentOptions = state.fulfillment === 'TAKEAWAY'
      ? ['ONLINE', 'PAY_AT_PICKUP'] as const
      : state.fulfillment === 'DELIVERY'
        ? ['ONLINE', 'CASH_ON_DELIVERY'] as const
        : [];
    const allowedOptions = responsePurpose === 'ASK_FULFILLMENT'
      ? ['DELIVERY', 'TAKEAWAY'] as const
      : paymentOptions;
    const availability = new Map(state.availabilitySnapshot.map((entry) => [entry.productId, entry.reasonCode]));
    return Object.freeze({
      responsePurpose,
      allowedFacts: Object.freeze(['DRAFT_ONLY', 'NO_OPERATIONAL_MUTATION']),
      allowedOptions: Object.freeze([...allowedOptions]),
      forbiddenClaims: Object.freeze(['pedido ya creado', 'pago confirmado', 'descuento aplicado', 'tiempo de entrega garantizado']),
      customerContextSafe: Object.freeze({ preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' }),
      fulfillment: state.fulfillment,
      paymentOptions: Object.freeze([...paymentOptions]),
      items: Object.freeze(state.items.map((item) => Object.freeze({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        modifiers: Object.freeze(item.modifiers.map((modifier) => Object.freeze({ ...modifier }))),
        available: availability.has(item.productId) ? availability.get(item.productId) === 'AVAILABLE' : null,
      }))),
      subtotal: state.subtotal,
      deliveryFee: state.deliveryFee,
      total: state.total,
      addressSafe: state.address,
      missingFields: Object.freeze([...state.missingFields]),
      confirmationRequired: state.confirmationState === 'PENDING',
      handoffRequired: state.handoffState === 'HUMAN_REQUIRED',
      reasonCode: state.domainErrors[0] ?? null,
      ...overrides,
    });
  }

  private async respond(
    state: CommercialConversationState,
    purpose: CommercialResponsePurpose,
    nextAction: CommercialTurnResult['nextAction'],
    overrides: Partial<CommercialFactEnvelope> = {},
  ): Promise<CommercialTurnResult> {
    const factEnvelope = this.factEnvelope(state, purpose, overrides);
    const composed = await this.responses.compose(factEnvelope);
    return {
      state,
      responseText: composed.text,
      nextAction,
      factEnvelope,
      responseComposition: { source: composed.source, violations: composed.validation.violations },
    };
  }

  private invalidateDraft(state: CommercialConversationState) { if (state.confirmationState === 'CONFIRMED' || state.confirmationState === 'PENDING') state.confirmationState = 'NONE'; }
  private async persistAndAudit(state: CommercialConversationState, command: CommercialMessageCommand, action: string) { await this.repository.saveState(state); await this.audit.record({ actor: command.actor, action, entity: 'sofia_commercial_conversation', entityId: state.conversationId, result: 'SUCCESS', after: { intent: state.intent, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, draftId: state.draftId, draftVersion: state.draftVersion, missingFields: state.missingFields } }); this.metrics.increment(action.includes('AMBIGUOUS') ? 'commercial_intent_ambiguous' : action.includes('DRAFT_CONFIRMED') ? 'draft_confirmed' : action.includes('DRAFT_CREATED') ? 'draft_created' : action.includes('DRAFT_UPDATED') ? 'draft_updated' : 'commercial_intent_resolved'); }
  private async handoff(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.handoffState = 'HUMAN_REQUIRED'; state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_HANDOFF_REQUESTED'); this.metrics.increment('handoff_requested'); return this.respond(state, 'HUMAN_HANDOFF', 'HANDOFF'); }
  private async dependencyFailure(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_DOMAIN_VALIDATION_FAILED'); return this.respond(state, 'DEPENDENCY_FAILURE', 'HANDOFF'); }
}
