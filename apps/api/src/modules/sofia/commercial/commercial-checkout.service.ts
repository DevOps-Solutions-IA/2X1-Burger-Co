import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  AUDIT_COMMAND_SERVICE,
  CATALOG_READ_SERVICE,
  CUSTOMER_RESOLUTION_SERVICE,
  DELIVERY_QUOTE_SERVICE,
  PRODUCT_AVAILABILITY_SERVICE,
  RECIPE_AVAILABILITY_SERVICE,
  type AuditCommandService,
  type CatalogProductDto,
  type CatalogReadService,
  type CustomerResolutionService,
  type DeliveryQuoteService,
  type ProductAvailabilityService,
  type RecipeAvailabilityService,
} from '../../../application/contracts/sofia-domain-contracts';
import { commercialDraftHash } from './commercial-draft-hash';
import { CommercialIntentEngine, normalizeCommercialText } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { COMMERCIAL_REPOSITORY, type CommercialRepository } from './commercial.repository';
import type { CommercialConversationState, CommercialMessageCommand, CommercialTurnResult, LastQuestionPurpose } from './commercial.types';

const emptyState = (conversationId: string): CommercialConversationState => ({
  conversationId, customerId: null, intent: 'UNKNOWN', items: [], fulfillment: null, address: null, location: null,
  paymentPreference: 'UNKNOWN', draftId: null, draftVersion: null, draftHash: null, confirmationState: 'NONE',
  missingFields: [], ambiguities: [], confidence: 'LOW', handoffState: 'SOFIA_ACTIVE', consentState: 'SERVICE',
  domainErrors: [], lastQuestionPurpose: null, lastResolvedIntent: null, expiresAt: null,
});

@Injectable()
export class CommercialCheckoutService {
  constructor(
    private readonly intents: CommercialIntentEngine,
    private readonly policy: CommercialPolicyService,
    private readonly metrics: CommercialMetricsService,
    @Inject(COMMERCIAL_REPOSITORY) private readonly repository: CommercialRepository,
    @Inject(CATALOG_READ_SERVICE) private readonly catalog: CatalogReadService,
    @Inject(PRODUCT_AVAILABILITY_SERVICE) private readonly productAvailability: ProductAvailabilityService,
    @Inject(RECIPE_AVAILABILITY_SERVICE) private readonly recipeAvailability: RecipeAvailabilityService,
    @Inject(CUSTOMER_RESOLUTION_SERVICE) private readonly customers: CustomerResolutionService,
    @Inject(DELIVERY_QUOTE_SERVICE) private readonly deliveryQuotes: DeliveryQuoteService,
    @Inject(AUDIT_COMMAND_SERVICE) private readonly audit: AuditCommandService,
  ) {}

  async process(command: CommercialMessageCommand): Promise<CommercialTurnResult> {
    const previous = await this.repository.loadState(command.conversationId) ?? emptyState(command.conversationId);
    const parsed = this.intents.interpret(command.message, previous.lastQuestionPurpose);
    const state: CommercialConversationState = { ...previous, intent: parsed.intent, confidence: parsed.confidence, ambiguities: [], domainErrors: [], lastResolvedIntent: parsed.intent !== 'UNKNOWN' ? parsed.intent : previous.lastResolvedIntent, location: command.location ?? previous.location };

    if (parsed.adversarial || parsed.intent === 'ASK_HUMAN') return this.handoff(state, command, 'SOFIA_UNTRUSTED_OR_HUMAN_REQUEST');
    if (parsed.intent === 'REJECT') {
      state.confirmationState = 'REJECTED';
      state.lastQuestionPurpose = null;
      await this.persistAndAudit(state, command, 'SOFIA_COMMERCIAL_CONFIRMATION_REJECTED');
      return { state, responseText: 'Entendido. No confirmaré ese borrador. Dime qué quieres cambiar.', nextAction: 'NO_ACTION', factEnvelope: { confirmation: 'REJECTED' } };
    }

    if (!state.customerId) {
      try {
        state.customerId = (await this.customers.resolve({ phone: command.phone, displayName: command.displayName, idempotencyKey: `commercial:${command.conversationId}`, actor: command.actor })).customerId;
      } catch { return this.dependencyFailure(state, command, 'CRM_UNAVAILABLE'); }
    }

    if (parsed.fulfillment) {
      if (state.fulfillment && state.fulfillment !== parsed.fulfillment) this.invalidateDraft(state);
      state.fulfillment = parsed.fulfillment;
      if (parsed.fulfillment === 'TAKEAWAY') state.address = null;
    }
    if (parsed.paymentPreference !== 'UNKNOWN') state.paymentPreference = parsed.paymentPreference;
    if (parsed.address) state.address = parsed.address;

    try { this.policy.validatePayment(state.fulfillment, state.paymentPreference); }
    catch { state.paymentPreference = 'UNKNOWN'; state.ambiguities.push('paymentPreference'); }

    const product = await this.resolveProduct(command.message);
    if (product === 'AMBIGUOUS') state.ambiguities.push('product');
    else if (product) {
      const quantity = parsed.quantity ?? 1;
      const item = { productId: product.id, code: product.code, name: product.name, quantity, unitPrice: product.persistedPrice, modifiers: parsed.modifiers };
      state.items = [item];
      this.invalidateDraft(state);
    }

    state.missingFields = this.policy.missing(state);
    if (state.ambiguities.length) state.missingFields = [...new Set([...state.missingFields, ...state.ambiguities])];

    if (parsed.intent === 'CONFIRM') return this.confirm(state, command);
    if (state.missingFields.length) {
      state.lastQuestionPurpose = this.policy.questionPurpose(state.missingFields);
      state.confirmationState = 'NONE';
      await this.persistAndAudit(state, command, state.confidence === 'LOW' ? 'SOFIA_COMMERCIAL_INTENT_AMBIGUOUS' : 'SOFIA_COMMERCIAL_INTENT_RESOLVED');
      return { state, responseText: this.question(state.lastQuestionPurpose, state.fulfillment), nextAction: 'ASK_MISSING', factEnvelope: { missingFields: state.missingFields } };
    }

    const prepared = await this.prepareDraft(state, command);
    prepared.lastQuestionPurpose = 'CONFIRM_ORDER';
    prepared.confirmationState = 'PENDING';
    await this.persistAndAudit(prepared, command, prepared.draftVersion === 1 ? 'SOFIA_DRAFT_CREATED' : 'SOFIA_DRAFT_UPDATED');
    return { state: prepared, responseText: this.summary(prepared), nextAction: 'READY_TO_CONFIRM', factEnvelope: this.factEnvelope(prepared) };
  }

  private async resolveProduct(message: string): Promise<CatalogProductDto | 'AMBIGUOUS' | null> {
    try {
      const normalized = normalizeCommercialText(message);
      const products = await this.catalog.listActive();
      const scored = products.map((product) => {
        const name = normalizeCommercialText(product.name);
        const aliases = [name, normalizeCommercialText(product.code), ...(name.includes('2x1') ? ['2x1', 'combo 2x1', 'promo 2x1'] : [])];
        return { product, score: Math.max(...aliases.map((alias) => normalized.includes(alias) ? alias.length : 0)) };
      }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
      if (!scored.length) return null;
      if (scored[1] && scored[1].score === scored[0]!.score && scored[1].product.persistedPrice !== scored[0]!.product.persistedPrice) return 'AMBIGUOUS';
      return scored[0]!.product;
    } catch { this.metrics.increment('catalog_failure'); throw new ServiceUnavailableException({ code: 'SOFIA_CATALOG_UNAVAILABLE' }); }
  }

  private async prepareDraft(state: CommercialConversationState, command: CommercialMessageCommand) {
    const availability = await Promise.all(state.items.map(async (item) => {
      const product = await this.catalog.getActiveById(item.productId);
      const result = product.kind === 'PREPARED' ? await this.recipeAvailability.check({ productId: item.productId, quantity: item.quantity }) : await this.productAvailability.check({ productId: item.productId, quantity: item.quantity });
      if (!result.available) throw new BadRequestException({ code: 'SOFIA_PRODUCT_UNAVAILABLE', reasonCode: result.reasonCode });
      for (const modifier of item.modifiers.filter((entry) => entry.kind === 'REMOVE')) {
        const ingredients = (result as { recipeIngredients?: Array<{ ingredientId: string; name: string }> }).recipeIngredients ?? [];
        if (!ingredients.some((ingredient) => normalizeCommercialText(ingredient.name).includes(normalizeCommercialText(modifier.name)))) throw new BadRequestException({ code: 'SOFIA_MODIFIER_UNSUPPORTED', modifier: modifier.name });
      }
      if (item.modifiers.some((entry) => entry.kind === 'ADD')) throw new BadRequestException({ code: 'SOFIA_MODIFIER_UNSUPPORTED' });
      return { productId: item.productId, quantity: item.quantity, checkedAt: result.checkedAt, reasonCode: result.reasonCode };
    }));
    const subtotal = state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let deliveryFee = 0, deliveryQuoteAuditId: string | null = null, deliveryQuoteVersion: number | null = null, deliveryQuoteExpiresAt: Date | null = null;
    if (state.fulfillment === 'DELIVERY') {
      const quote = await this.deliveryQuotes.quote({ addressText: state.address!, orderSubtotal: subtotal, actor: command.actor });
      if (!quote.canCheckout || quote.finalFee === null || !quote.auditId) throw new BadRequestException({ code: 'SOFIA_DELIVERY_QUOTE_REQUIRED', reasonCode: quote.reasonCode });
      deliveryFee = quote.finalFee; deliveryQuoteAuditId = quote.auditId;
      deliveryQuoteVersion = Number(quote.calculationVersion.match(/v(\d+)$/)?.[1] ?? 0) || null;
      deliveryQuoteExpiresAt = new Date(Date.now() + 15 * 60_000);
    }
    const version = state.draftVersion ? state.draftVersion + 1 : 1;
    const saved = await this.repository.saveDraft({ draftId: state.draftId ?? undefined, conversationId: state.conversationId, customerId: state.customerId, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, version, items: state.items, subtotal, deliveryFee, total: subtotal + deliveryFee, address: state.address, deliveryQuoteAuditId, deliveryQuoteVersion, deliveryQuoteExpiresAt, availabilitySnapshot: availability });
    return { ...state, draftId: saved.id, draftVersion: saved.version, draftHash: saved.draftHash, expiresAt: saved.expiresAt.toISOString(), domainErrors: [] };
  }

  private async confirm(state: CommercialConversationState, command: CommercialMessageCommand): Promise<CommercialTurnResult> {
    if (state.lastQuestionPurpose !== 'CONFIRM_ORDER' || !state.draftId || !state.draftVersion || !state.draftHash || !state.expiresAt) return this.handoff(state, command, 'SOFIA_CONTEXTUAL_CONFIRMATION_INVALID');
    if (new Date(state.expiresAt) <= new Date()) { state.confirmationState = 'EXPIRED'; return this.dependencyFailure(state, command, 'SOFIA_DRAFT_EXPIRED'); }
    const confirmationHash = commercialDraftHash({ draftId: state.draftId, version: state.draftVersion, draftHash: state.draftHash, customerId: state.customerId, conversationId: state.conversationId });
    await this.repository.confirmDraft({ draftId: state.draftId, expectedVersion: state.draftVersion, expectedHash: state.draftHash, confirmationHash });
    state.confirmationState = 'CONFIRMED'; state.lastQuestionPurpose = null;
    await this.persistAndAudit(state, command, 'SOFIA_DRAFT_CONFIRMED');
    return { state, responseText: 'Quedó confirmado como borrador supervisado. Aún no se creó pedido, pago ni envío.', nextAction: 'DRAFT_CONFIRMED', factEnvelope: { ...this.factEnvelope(state), operationalOrderCreated: false } };
  }

  private question(purpose: LastQuestionPurpose, fulfillment: CommercialConversationState['fulfillment']) {
    if (purpose === 'PRODUCT') return '¿Qué producto quieres pedir? Puedo revisar el catálogo activo.';
    if (purpose === 'FULFILLMENT') return '¿Prefieres que te lo enviemos o pasas a recogerlo?';
    if (purpose === 'PAYMENT') return fulfillment === 'TAKEAWAY' ? '¿Lo pagas ahora en línea o cuando vengas por él?' : '¿Lo pagas ahora o en efectivo cuando llegue?';
    if (purpose === 'DELIVERY_ADDRESS') return '¿A qué dirección debemos enviarlo?';
    return '¿Confirmamos así?';
  }

  private summary(state: CommercialConversationState) {
    const items = state.items.map((item) => `${item.quantity} ${item.name}${item.modifiers.length ? ` (${item.modifiers.map((m) => `${m.kind === 'REMOVE' ? 'sin' : 'con'} ${m.name}`).join(', ')})` : ''}`).join(', ');
    const subtotal = state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const mode = state.fulfillment === 'TAKEAWAY' ? 'para recoger' : `para enviar a ${state.address}`;
    return `Te confirmo: ${items}, ${mode}. Subtotal $${subtotal.toLocaleString('es-CO')}. El total y condiciones están en el borrador vigente. ¿Confirmamos así?`;
  }

  private factEnvelope(state: CommercialConversationState) { return { draftId: state.draftId, version: state.draftVersion, hash: state.draftHash, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, items: state.items, expiresAt: state.expiresAt }; }
  private invalidateDraft(state: CommercialConversationState) { if (state.confirmationState === 'CONFIRMED' || state.confirmationState === 'PENDING') state.confirmationState = 'NONE'; }
  private async persistAndAudit(state: CommercialConversationState, command: CommercialMessageCommand, action: string) { await this.repository.saveState(state); await this.audit.record({ actor: command.actor, action, entity: 'sofia_commercial_conversation', entityId: state.conversationId, result: 'SUCCESS', after: { intent: state.intent, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, draftId: state.draftId, draftVersion: state.draftVersion, missingFields: state.missingFields } }); this.metrics.increment(action.includes('AMBIGUOUS') ? 'commercial_intent_ambiguous' : action.includes('DRAFT_CONFIRMED') ? 'draft_confirmed' : action.includes('DRAFT_CREATED') ? 'draft_created' : action.includes('DRAFT_UPDATED') ? 'draft_updated' : 'commercial_intent_resolved'); }
  private async handoff(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.handoffState = 'HUMAN_REQUIRED'; state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_HANDOFF_REQUESTED'); this.metrics.increment('handoff_requested'); return { state, responseText: 'Prefiero pasarte con el equipo para resolverlo sin arriesgar datos o cobros incorrectos.', nextAction: 'HANDOFF', factEnvelope: { reasonCode: code } }; }
  private async dependencyFailure(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_DOMAIN_VALIDATION_FAILED'); return { state, responseText: 'En este momento no puedo confirmar los datos de forma segura. Prefiero no darte información incorrecta.', nextAction: 'HANDOFF', factEnvelope: { reasonCode: code } }; }
}
