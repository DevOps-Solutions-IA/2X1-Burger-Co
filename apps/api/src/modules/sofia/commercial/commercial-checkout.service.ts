import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
import { commercialDraftHash, commercialItemsFingerprint } from './commercial-draft-hash';
import { CommercialIntentEngine, normalizeCommercialText } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { COMMERCIAL_REPOSITORY, DraftAlreadyConfirmedError, type CommercialRepository } from './commercial.repository';
import type { CommercialConversationState, CommercialItem, CommercialMessageCommand, CommercialTurnResult, LastQuestionPurpose } from './commercial.types';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import type { CommercialFactEnvelope, CommercialResponsePurpose } from './response/commercial-response.types';
import {
  applyDestinationEdit,
  createInitialDestinationSnapshot,
  isCoordinateProvisionallyUsable,
  isQuoteBoundToCurrentDestination,
  quoteBindingFor,
  type DestinationQuoteBinding,
} from '../../../delivery/destination-state/destination-revision';
import type { DestinationEdit, DestinationSnapshot } from '../../../delivery/destination-state/destination-snapshot.types';

type CommercialParsedMessage = ReturnType<CommercialIntentEngine['interpret']>;

const emptyState = (conversationId: string): CommercialConversationState => ({
  schemaVersion: 4, conversationId, customerId: null, intent: 'UNKNOWN', items: [], fulfillment: null, address: null, addressConfirmed: false, location: null,
  destinationSnapshot: null, deliveryQuoteDestinationBinding: null,
  paymentPreference: 'UNKNOWN', paymentReadiness: 'PAYMENT_UNRESOLVED', subtotal: null, deliveryFee: null, total: null, deliveryQuoteAuditId: null,
  deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [], draftId: null, draftVersion: null,
  draftHash: null, draftFulfillment: null, draftItemsFingerprint: null, draftPaymentPreference: null, confirmationState: 'NONE',
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
    // NOTE (A9/A10 CLOSURE — HIGH finding): `location` is deliberately NOT carried forward here as
    // `command.location ?? previous.location` anymore. A live GPS share must be routed through
    // `applyDestinationEdit` (below) so it is bound to a specific destination revision instead of
    // floating globally across turns — otherwise an old GPS point silently outlives a later textual
    // address change (see `destination-snapshot.types.ts` file header). `state.location` below
    // still starts as `previous.location` via the spread and is only ever RE-DERIVED from
    // `state.destinationSnapshot` in the destination-edit block further down.
    const state: CommercialConversationState = { ...previous, intent: parsed.intent, confidence: parsed.confidence, ambiguities: [], domainErrors: [], lastResolvedIntent: parsed.intent !== 'UNKNOWN' ? parsed.intent : previous.lastResolvedIntent };

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
        state.location = null;
        state.destinationSnapshot = null;
        state.deliveryFee = 0;
        state.deliveryQuoteAuditId = null;
        state.deliveryQuoteVersion = null;
        state.deliveryQuoteExpiresAt = null;
        state.deliveryQuoteDestinationBinding = null;
      }
    }
    if (parsed.paymentPreference !== 'UNKNOWN') state.paymentPreference = parsed.paymentPreference;

    // SOFIA Round 5 / A10 CLOSURE — routes EVERY destination-affecting signal for this turn (a new
    // textual address AND/OR a shared GPS point) through A9's single canonical state-transition
    // function instead of independently deciding whether to keep/discard coordinates (the exact
    // per-caller re-derivation that produced the CRITICAL/HIGH findings this round closes).
    //
    // FAIL-CLOSED REPLAY GUARD (Scenario D — out-of-order GPS replay): `CommercialMessageCommand`
    // carries no message ordering/event-id today, so a delayed re-delivery of an OLD WhatsApp
    // live-location share is indistinguishable, at the transport level, from a genuinely fresh
    // share. We cannot prove causality either way — but we CAN detect the one case that is
    // objectively suspicious without any additional plumbing: the incoming coordinate pair being
    // byte-identical to a pair this conversation already knows is STALE (bound to a PAST revision).
    // A live GPS reading reproducing that exact old value immediately after the address changed is
    // far more consistent with a transport-layer replay of the old event than a fresh, coincidental
    // re-share — so we fail closed and refuse to let it silently re-bind to the CURRENT revision.
    // This never blocks a legitimate resend of a DIFFERENT (even nearby) point, and never blocks the
    // address-text portion of the same turn.
    const staleCoordinateReplay = Boolean(
      command.location
      && state.destinationSnapshot
      && state.destinationSnapshot.coordinateTrust === 'STALE'
      && state.destinationSnapshot.latitude === command.location.latitude
      && state.destinationSnapshot.longitude === command.location.longitude,
    );
    if (staleCoordinateReplay) this.metrics.increment('stale_coordinate_replay_rejected');
    const acceptCoordinates = Boolean(command.location) && !staleCoordinateReplay;

    if (parsed.address || acceptCoordinates) {
      const destinationEdit: DestinationEdit = {};
      if (parsed.address) destinationEdit.rawReferenceText = parsed.address;
      if (acceptCoordinates && command.location) {
        destinationEdit.coordinates = {
          latitude: command.location.latitude,
          longitude: command.location.longitude,
          source: 'GPS_SHARE',
          confidence: 'HIGH',
        };
      }
      const { snapshot, revisionBumped } = applyDestinationEdit(this.baselineDestinationSnapshot(state), destinationEdit);
      state.destinationSnapshot = snapshot;
      state.address = snapshot.referenceText;
      state.addressConfirmed = Boolean(snapshot.referenceText);
      state.location = isCoordinateProvisionallyUsable(snapshot)
        ? { latitude: snapshot.latitude!, longitude: snapshot.longitude! }
        : null;
      // The destination's spatial identity actually moved (or could not be proven unchanged,
      // fail-closed AMBIGUOUS) — any previously PENDING/CONFIRMED draft was priced/confirmed
      // against the OLD identity and must never be replayed as-is (see `confirm()`'s
      // `isQuoteBoundToCurrentDestination` check for the second, compound-message-safe layer of
      // this same guard).
      if (revisionBumped) this.invalidateDraft(state);
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

    if (parsed.intent === 'CONFIRM') return this.confirm(state, command, previous, { parsed, acceptCoordinates });
    if (state.missingFields.length) {
      state.lastQuestionPurpose = this.policy.questionPurpose(state.missingFields);
      state.confirmationState = 'NONE';
      await this.persistAndAudit(state, command, state.confidence === 'LOW' ? 'SOFIA_COMMERCIAL_INTENT_AMBIGUOUS' : 'SOFIA_COMMERCIAL_INTENT_RESOLVED');
      return this.respond(state, this.responsePurpose(state.lastQuestionPurpose, state.ambiguities), 'ASK_MISSING');
    }

    let prepared: CommercialConversationState;
    try {
      prepared = await this.prepareDraft(state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) });
    } catch (error) {
      const outcome = await this.recoverDraftConflict(error, state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) }, { parsed, acceptCoordinates });
      if (!outcome.recovered) throw error;
      if (outcome.kind !== 'RETRY_SUCCEEDED') return outcome.result;
      prepared = outcome.prepared;
    }
    prepared.lastQuestionPurpose = 'CONFIRM_ORDER';
    prepared.confirmationState = 'PENDING';
    await this.persistAndAudit(prepared, command, prepared.draftVersion === 1 ? 'SOFIA_DRAFT_CREATED' : 'SOFIA_DRAFT_UPDATED');
    return this.respond(prepared, 'SUMMARIZE_DRAFT', 'READY_TO_CONFIRM');
  }

  /**
   * SOFIA Round 5 / A26 CLOSURE (root cause #2) — `true` only when THIS turn's own, non-stale
   * `previous` read (captured at the very top of `process()`, before any in-turn mutation) already,
   * truthfully knew `state`'s tracked draft was CONFIRMED. This is the one signal `saveDraft()` is
   * allowed to trust when deciding whether a CAS failure against an already-CONFIRMED draft means
   * "genuinely start a new order" (safe -- the caller knew) versus "I have no idea this draft was
   * already confirmed" (the A25 lost-update hazard -- the caller must NOT silently spin off a shadow
   * draft). See `DraftAlreadyConfirmedError` for the failure mode when this is `false`.
   */
  private allowsNewDraftAfterConfirm(previous: CommercialConversationState, state: CommercialConversationState): boolean {
    return previous.confirmationState === 'CONFIRMED' && previous.draftId !== null && previous.draftId === state.draftId;
  }

  /**
   * SOFIA Round 5 / A26 CLOSURE (root cause #2) — recovery path when `saveDraft()` reports that the
   * draft this turn was tracking is already CONFIRMED and this turn had no idea (see
   * `DraftAlreadyConfirmedError`). Reloads the AUTHORITATIVE persisted state instead of trusting this
   * turn's own (proven-stale) in-memory `state`, and narrates the true outcome to the customer --
   * "your order is already confirmed" -- instead of silently creating and later confirming a second,
   * phantom draft for the same conversation. Never regresses durable memory: if the authoritative
   * read already reflects the confirmation (the expected case -- the confirming turn's own
   * `saveState()` already committed it, protected by root cause #1's row lock), this makes NO
   * additional write at all.
   */
  private async respondDraftAlreadyConfirmed(
    state: CommercialConversationState,
    command: CommercialMessageCommand,
    error: DraftAlreadyConfirmedError,
  ): Promise<CommercialTurnResult> {
    this.metrics.increment('draft_already_confirmed_race_detected');
    const authoritative = await this.repository.loadState(command.conversationId);
    const alreadyCorrect = authoritative?.confirmationState === 'CONFIRMED' && authoritative.draftId === error.draftId;
    const resolved: CommercialConversationState = alreadyCorrect
      ? authoritative!
      : { ...state, draftId: error.draftId, confirmationState: 'CONFIRMED', lastQuestionPurpose: null };
    if (!alreadyCorrect) await this.repository.saveState(resolved);
    await this.audit.record({
      actor: command.actor,
      action: 'SOFIA_DRAFT_ALREADY_CONFIRMED_RACE_DETECTED',
      entity: 'sofia_commercial_conversation',
      entityId: state.conversationId,
      result: 'SUCCESS',
      after: { draftId: resolved.draftId, confirmationState: resolved.confirmationState },
    });
    return this.respond(resolved, resolved.fulfillment === 'DELIVERY' ? 'DELIVERY_CONFIRMED' : 'TAKEAWAY_CONFIRMED', 'DRAFT_CONFIRMED');
  }

  private conflictCode(error: unknown): string | null {
    if (!(error instanceof ConflictException)) return null;
    const response = error.getResponse();
    return typeof response === 'object' && response !== null ? (response as { code?: string }).code ?? null : null;
  }

  private isStaleDraftVersionConflict(error: unknown): boolean {
    return this.conflictCode(error) === 'STALE_DRAFT_VERSION';
  }

  private isStaleConfirmationConflict(error: unknown): boolean {
    return this.conflictCode(error) === 'SOFIA_STALE_CONFIRMATION';
  }

  /**
   * SOFIA Round 5 / A36 CLOSURE (A35 blind red-team finding, MEDIUM) — recovers from the sibling CAS
   * failure `saveDraft()` can throw alongside `DraftAlreadyConfirmedError`:
   * `ConflictException({code:'STALE_DRAFT_VERSION'})`, thrown when a DIFFERENT, genuinely concurrent
   * turn's ordinary (non-confirming) write to the SAME draft wins the optimistic-concurrency race
   * first (e.g. a customer double/triple-tapping an item-adding message like "También quiero una Coca
   * Cola"). Postgres already ensures exactly one writer's rebuild lands — this is purely about giving
   * the LOSING turn the same graceful, non-throwing recovery `DraftAlreadyConfirmedError` already gets
   * one branch over, instead of an uncaught exception reaching `SofiaWhatsappService`'s outer catch.
   *
   * Every `prepareDraft()` call site funnels its catch block through here so `DraftAlreadyConfirmedError`
   * and `STALE_DRAFT_VERSION` share one recovery path, while still letting each call site apply its own
   * post-success bookkeeping (audit action codes, site-specific metrics, response purpose) when a retry
   * actually succeeds.
   *
   * SOFIA Round 5 / A38 CLOSURE (A37 blind red-team findings, CRITICAL + HIGH) — the retry no longer
   * patches ONLY `draftVersion` onto this turn's own (by-then-proven-stale) in-memory `state` and
   * replays it as-is. That let a losing turn silently re-persist a stale destination/items snapshot
   * over a concurrent winner's already-committed, already customer-facing change (a reverted address
   * correction; a permanently erased sibling item addition) -- worse than the pre-A36 uncaught
   * exception, because it reported full success while quietly destroying evidence. The retry now
   * reloads the FULL authoritative conversation state (`repository.loadState()`, not just the draft's
   * version number) and re-applies THIS TURN's own genuine delta (`turnDelta`, captured by the caller
   * at the moment it was originally derived) on top of that fresh baseline via
   * `rebaseTurnOntoFreshState()` -- exactly what re-running this turn against current reality would
   * produce, so the retry naturally incorporates whatever the concurrent winner already committed
   * instead of clobbering it. "Retry once, then safe QUOTE_EXPIRED respond" discipline is unchanged: a
   * genuine second collision after the corrected retry still falls through to the safe response below
   * rather than looping.
   */
  private async recoverDraftConflict(
    error: unknown,
    state: CommercialConversationState,
    command: CommercialMessageCommand,
    options: { allowNewDraftAfterConfirm: boolean },
    turnDelta: { parsed: CommercialParsedMessage; acceptCoordinates: boolean },
  ): Promise<
    | { recovered: false }
    | { recovered: true; kind: 'ALREADY_CONFIRMED' | 'RETRY_EXHAUSTED'; result: CommercialTurnResult }
    | { recovered: true; kind: 'RETRY_SUCCEEDED'; prepared: CommercialConversationState }
  > {
    if (error instanceof DraftAlreadyConfirmedError) {
      return { recovered: true, kind: 'ALREADY_CONFIRMED', result: await this.respondDraftAlreadyConfirmed(state, command, error) };
    }
    if (!this.isStaleDraftVersionConflict(error)) return { recovered: false };

    this.metrics.increment('stale_draft_version_race_detected');
    const fresh = state.draftId ? await this.repository.loadDraftVersion(state.draftId) : null;
    if (fresh?.status === 'CONFIRMED') {
      // The concurrent winner's write was actually a confirmation -- same graceful "already
      // confirmed" recovery as the sibling `DraftAlreadyConfirmedError` race.
      return {
        recovered: true,
        kind: 'ALREADY_CONFIRMED',
        result: await this.respondDraftAlreadyConfirmed(state, command, new DraftAlreadyConfirmedError(state.draftId!)),
      };
    }
    if (fresh) {
      // Retry ONCE against the now-current authoritative version (read directly from `SofiaOrderDraft`,
      // not the possibly-not-yet-committed conversation-memory snapshot) AND against the now-current
      // authoritative conversation state (destination/items/fulfillment/payment) -- see A38 CLOSURE
      // doc above -- so this turn's own genuine intent is still honored against current reality
      // instead of being silently dropped, and without clobbering a concurrent winner's own change.
      try {
        const rebased = await this.rebaseTurnOntoFreshState(state, command, turnDelta);
        if (rebased && !rebased.missingFields.length) {
          const prepared = await this.prepareDraft({ ...rebased, draftVersion: fresh.version }, command, options);
          return { recovered: true, kind: 'RETRY_SUCCEEDED', prepared };
        }
        // Either there was no authoritative conversation-memory row to rebase onto (should not
        // normally happen once a draft exists), or re-deriving this turn against fresh reality now
        // leaves required fields missing (e.g. a concurrent winner reset fulfillment) -- never call
        // `prepareDraft()` with an incomplete/unrebased state; fall through to the safe response below
        // instead of guessing.
      } catch (retryError) {
        if (retryError instanceof DraftAlreadyConfirmedError) {
          return { recovered: true, kind: 'ALREADY_CONFIRMED', result: await this.respondDraftAlreadyConfirmed(state, command, retryError) };
        }
        if (!this.isStaleDraftVersionConflict(retryError)) throw retryError;
        // Fall through: a second consecutive collision is rare enough that we stop retrying rather
        // than loop indefinitely, and respond safely below instead.
      }
    }

    // Authoritative reload unavailable, or the retry itself lost a second race: never let the
    // customer's turn crash. Reload the best-known authoritative state and ask them to resend,
    // reusing the same `QUOTE_EXPIRED` narration already used by the sibling expiry-refresh path.
    const authoritative = (await this.repository.loadState(command.conversationId)) ?? state;
    await this.audit.record({
      actor: command.actor,
      action: 'SOFIA_DRAFT_VERSION_CONFLICT_RETRY_EXHAUSTED',
      entity: 'sofia_commercial_conversation',
      entityId: state.conversationId,
      result: 'SUCCESS',
      after: { draftId: authoritative.draftId, draftVersion: authoritative.draftVersion },
    });
    return { recovered: true, kind: 'RETRY_EXHAUSTED', result: await this.respond(authoritative, 'QUOTE_EXPIRED', 'READY_TO_CONFIRM') };
  }

  /**
   * SOFIA Round 5 / A38 CLOSURE (A37 blind red-team findings, CRITICAL + HIGH) — re-derives THIS
   * turn's own genuine delta (`turnDelta`, captured by the caller at the exact point it was originally
   * computed in `process()`/`confirm()`, BEFORE the CAS conflict was ever discovered) against a
   * freshly reloaded AUTHORITATIVE conversation state, instead of trusting `state`'s own
   * already-proven-stale in-memory snapshot of axes this turn never touched. This is the fix for both
   * A37 findings, which shared one root cause: a losing turn's retry blindly replaying its own stale
   * `state.items`/`state.destinationSnapshot` (computed against a `previous` read BEFORE a concurrent
   * winner committed) as a whole-value overwrite at the new version number.
   *
   * Returns `null` only when there is no authoritative `sofiaConversationMemory` row to rebase onto at
   * all (should not normally happen once a draft/conversation exists) — the caller must treat that as
   * "cannot safely retry" and fall through to the safe response, never call `prepareDraft()` with an
   * un-rebased state.
   *
   * SOFIA Round 5 / A40 CLOSURE (A39 blind red-team finding, HIGH) — this method rebases axes drawn
   * from potentially TWO DIFFERENT turns (THIS turn's own `parsed`/`acceptCoordinates`, and a
   * DIFFERENT, concurrently-committed turn's `freshState`), so an ordering assumption that is safe in
   * `process()` (every block always acts on the SAME single message) is NOT automatically safe here.
   * The DESTINATION axis block below now explicitly checks what the FULFILLMENT axis block just
   * resolved `rebased.fulfillment` to before ever applying THIS turn's own destination edit — see that
   * block's own comment for the full incident writeup and fix rationale. Every OTHER block in this
   * method was re-audited for the same class of hazard as part of the A40 closure: `paymentPreference`/
   * `paymentReadiness` derivation only ever reads `rebased.fulfillment` (already fully resolved by that
   * point) and `rebased.paymentPreference` (this turn's own override or the fresh inherited value, both
   * already finalized) — no stale cross-turn read. `applyItemsMutation()` is a pure function of
   * `freshState.items`/`parsed`/`command.message` alone and has no fulfillment dependency anywhere in
   * the underlying `ProductAvailabilityService`/`RecipeAvailabilityService` contracts (verified: both
   * take only `{ productId, quantity }`) — a fulfillment change occurring on a different turn cannot
   * corrupt an item mutation rebased on top of it.
   */
  private async rebaseTurnOntoFreshState(
    state: CommercialConversationState,
    command: CommercialMessageCommand,
    turnDelta: { parsed: CommercialParsedMessage; acceptCoordinates: boolean },
  ): Promise<CommercialConversationState | null> {
    const freshState = await this.repository.loadState(command.conversationId);
    if (!freshState) return null;
    const { parsed, acceptCoordinates } = turnDelta;

    const rebased: CommercialConversationState = {
      ...freshState,
      // This turn's own parse-derived bookkeeping — purely this turn's own interpretation of its own
      // message, not a concurrency-sensitive axis, so it is always safe to carry forward as-is.
      intent: state.intent,
      confidence: state.confidence,
      ambiguities: [...state.ambiguities],
      domainErrors: state.domainErrors,
      lastResolvedIntent: state.lastResolvedIntent,
      customerId: state.customerId ?? freshState.customerId,
    };

    // FULFILLMENT axis: only overwrite when THIS turn's own message actually specified a fulfillment
    // — otherwise inherit the FRESH authoritative value instead of the possibly-stale one `state`
    // carried forward from the original (now-proven-stale) `previous` read.
    if (parsed.fulfillment) {
      rebased.fulfillment = parsed.fulfillment;
      if (parsed.fulfillment === 'TAKEAWAY') {
        rebased.address = null;
        rebased.addressConfirmed = false;
        rebased.location = null;
        rebased.destinationSnapshot = null;
        rebased.deliveryFee = 0;
        rebased.deliveryQuoteAuditId = null;
        rebased.deliveryQuoteVersion = null;
        rebased.deliveryQuoteExpiresAt = null;
        rebased.deliveryQuoteDestinationBinding = null;
      }
    }
    if (parsed.paymentPreference !== 'UNKNOWN') rebased.paymentPreference = parsed.paymentPreference;

    // DESTINATION axis (A37 CRITICAL finding; A39 HIGH finding hardening): reapply THIS TURN's own
    // destination edit (address text and/or a shared GPS point — exactly the same edit `process()`
    // originally computed) on top of the FRESH authoritative destination snapshot, never the stale
    // one. A coordinate-only edit (RULE 3 — no revision bump) now refines whatever address is
    // CURRENTLY authoritative instead of silently reviving an address a concurrent winner already
    // corrected away from.
    //
    // A39 CLOSURE (HIGH): this block used to run UNCONDITIONALLY whenever `parsed.address ||
    // acceptCoordinates`, with no check of what `rebased.fulfillment` was just set/inherited to two
    // lines above. `process()` has the exact same ordering (fulfillment block before destination
    // block) and it IS safe there, because both blocks always act on the SAME single message from
    // the SAME turn — a TAKEAWAY-only message never carries an unrelated address, and an
    // address-only message never touches fulfillment. That safety does NOT carry over to the rebase
    // path: `rebased.fulfillment` can now come from a totally DIFFERENT, concurrently-committed
    // turn's message (inherited from `freshState` a few lines above), while `parsed`/`acceptCoordinates`
    // still describe THIS turn's own, unrelated message. Applying a destination edit on top of a
    // fulfillment that just became TAKEAWAY for reasons THIS turn knows nothing about reproduced
    // exactly the same "pickup order with a delivery address" invariant violation the TAKEAWAY-
    // clearing branch above exists to prevent — just one turn later. A pickup order has no
    // destination, full stop: gate this block on `rebased.fulfillment === 'DELIVERY'`, matching that
    // same invariant.
    if (rebased.fulfillment === 'DELIVERY' && (parsed.address || acceptCoordinates)) {
      const destinationEdit: DestinationEdit = {};
      if (parsed.address) destinationEdit.rawReferenceText = parsed.address;
      if (acceptCoordinates && command.location) {
        destinationEdit.coordinates = {
          latitude: command.location.latitude,
          longitude: command.location.longitude,
          source: 'GPS_SHARE',
          confidence: 'HIGH',
        };
      }
      const { snapshot } = applyDestinationEdit(this.baselineDestinationSnapshot(rebased), destinationEdit);
      rebased.destinationSnapshot = snapshot;
      rebased.address = snapshot.referenceText;
      rebased.addressConfirmed = Boolean(snapshot.referenceText);
      rebased.location = isCoordinateProvisionallyUsable(snapshot)
        ? { latitude: snapshot.latitude!, longitude: snapshot.longitude! }
        : null;
    } else if (rebased.fulfillment !== 'DELIVERY' && (parsed.address || acceptCoordinates)) {
      // THIS turn's own destination edit no longer applies to the fulfillment it was just rebased
      // onto — either THIS turn itself just switched to TAKEAWAY (parsed.fulfillment === 'TAKEAWAY',
      // already cleared above) or a DIFFERENT, concurrently-committed turn did while this turn was
      // mid-flight (rebased.fulfillment inherited as TAKEAWAY/null from `freshState`). Silently
      // keeping the stale address text would recreate the exact A39 hybrid; silently discarding it
      // with no trace at all would quietly eat a genuine customer message with no record anywhere.
      // Record it as an ambiguity instead: `rebased.missingFields` becomes non-empty below, which is
      // exactly the signal `recoverDraftConflict()` already checks to decide whether this rebase is
      // safe to hand to `prepareDraft()` — a non-empty result makes it intentionally NOT treat this
      // rebase as a clean success, and instead fall through to the existing safe `QUOTE_EXPIRED`
      // re-sync response, which reloads the true authoritative (self-consistent) state and asks the
      // customer to confirm/resend. Same "ask again" discipline already used for every other kind of
      // second collision — no inconsistent hybrid is ever handed to `prepareDraft()`/persisted.
      rebased.ambiguities = [...rebased.ambiguities, 'destinationFulfillmentMismatch'];
    }

    try { this.policy.validatePayment(rebased.fulfillment, rebased.paymentPreference); }
    catch { rebased.paymentPreference = 'UNKNOWN'; rebased.ambiguities = [...rebased.ambiguities, 'paymentPreference']; }
    rebased.paymentReadiness = rebased.paymentPreference === 'ONLINE'
      ? 'PAYMENT_READY_ONLINE'
      : rebased.paymentPreference === 'CASH_ON_DELIVERY'
        ? 'PAYMENT_COD'
        : rebased.paymentPreference === 'PAY_AT_PICKUP'
          ? 'PAYMENT_AT_PICKUP'
          : 'PAYMENT_UNRESOLVED';

    // ITEMS axis (A37 HIGH finding): re-run THIS TURN's own item mutation (product mention / bare
    // quantity change / modifier change) against the FRESH authoritative items list, instead of
    // blindly persisting the stale whole-array `state.items` snapshot already computed against the
    // old baseline — see `applyItemsMutation()`. This is what naturally preserves a concurrent
    // winner's own, different item addition instead of silently overwriting it.
    rebased.items = await this.applyItemsMutation(freshState.items, parsed, command);

    rebased.missingFields = this.policy.missing(rebased);
    if (rebased.ambiguities.length) rebased.missingFields = [...new Set([...rebased.missingFields, ...rebased.ambiguities])];

    return rebased;
  }

  /**
   * SOFIA Round 5 / A38 CLOSURE — the exact item-mutation logic `process()` applies inline (product
   * mention resolution, bare-quantity change, modifier changes), factored out and parameterized on
   * `baseItems` so `rebaseTurnOntoFreshState()` can re-run THIS turn's own item delta against a FRESH
   * authoritative items list instead of the stale one `process()` originally computed against. Pure
   * function of `baseItems`/`parsed`/`command.message` (plus a live catalog read) — never reads
   * `this.repository` — so it is safe to call a second time during retry without side effects beyond
   * the idempotent catalog lookup.
   */
  private async applyItemsMutation(
    baseItems: CommercialItem[],
    parsed: CommercialParsedMessage,
    command: CommercialMessageCommand,
  ): Promise<CommercialItem[]> {
    const products = await this.resolveProducts(command.message);
    if (products === 'AMBIGUOUS' || !products.length) {
      if (baseItems.length === 1 && parsed.quantity) return [{ ...baseItems[0]!, quantity: parsed.quantity }];
      if (baseItems.length && parsed.clearModifiers) return [{ ...baseItems[0]!, modifiers: [] }, ...baseItems.slice(1)];
      if (baseItems.length && parsed.modifiers.length) return [{ ...baseItems[0]!, modifiers: parsed.modifiers }, ...baseItems.slice(1)];
      return baseItems;
    }
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
    return [...baseItems.filter((item) => !mentioned.has(item.productId)), ...nextItems];
  }

  /**
   * SOFIA Round 5 / A36 CLOSURE (A35 blind red-team finding, MEDIUM) — recovers from
   * `confirmDraft()`'s own final, unconditional CAS failure
   * (`ConflictException({code:'SOFIA_STALE_CONFIRMATION'})`), the one write path in `confirm()` that
   * previously had no matching graceful-recovery treatment. By the time execution reaches this call,
   * every earlier guard in `confirm()` (expiry, fulfillment/items/payment/destination binding, price)
   * has already passed for THIS turn's own view of the draft, so the only remaining way the CAS can
   * still fail is a DIFFERENT, genuinely concurrent turn for the SAME conversation racing the same
   * confirm — almost always another confirming ("Sí") turn that legitimately won. Reuses
   * `respondDraftAlreadyConfirmed()` directly for that (overwhelmingly common) case; falls back to the
   * same safe `QUOTE_EXPIRED` re-sync response `recoverDraftConflict()` uses for the rare case where
   * the authoritative draft is not actually CONFIRMED (e.g. it expired between this turn's earlier
   * checks and this final write).
   */
  private async recoverStaleConfirmation(
    state: CommercialConversationState,
    command: CommercialMessageCommand,
    error: ConflictException,
  ): Promise<CommercialTurnResult> {
    this.metrics.increment('stale_confirmation_race_detected');
    const fresh = state.draftId ? await this.repository.loadDraftVersion(state.draftId) : null;
    if (fresh?.status === 'CONFIRMED') {
      return this.respondDraftAlreadyConfirmed(state, command, new DraftAlreadyConfirmedError(state.draftId!));
    }
    const authoritative = (await this.repository.loadState(command.conversationId)) ?? state;
    await this.audit.record({
      actor: command.actor,
      action: 'SOFIA_STALE_CONFIRMATION_RETRY_EXHAUSTED',
      entity: 'sofia_commercial_conversation',
      entityId: state.conversationId,
      result: 'SUCCESS',
      after: { draftId: authoritative.draftId, draftVersion: authoritative.draftVersion, code: this.conflictCode(error) },
    });
    return this.respond(authoritative, 'QUOTE_EXPIRED', 'READY_TO_CONFIRM');
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

  private async prepareDraft(state: CommercialConversationState, command: CommercialMessageCommand, options: { allowNewDraftAfterConfirm: boolean } = { allowNewDraftAfterConfirm: false }) {
    const availability = await this.validateAvailability(state);
    const subtotal = state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let deliveryFee = 0, deliveryQuoteAuditId: string | null = null, deliveryQuoteVersion: number | null = null, deliveryQuoteExpiresAt: Date | null = null;
    let deliveryQuoteDestinationBinding: DestinationQuoteBinding | null = null;
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
      // QUOTE BINDING (SOFIA Round 5 / A10): record EXACTLY which destination identity this quote
      // was computed against, so a later `confirm()` can prove (or refuse to assume) it is still
      // the current one — `quote.destinationRevision == currentDestination.revision`.
      deliveryQuoteDestinationBinding = state.destinationSnapshot ? quoteBindingFor(state.destinationSnapshot) : null;
    }
    const version = state.draftVersion ? state.draftVersion + 1 : 1;
    const saved = await this.repository.saveDraft({ draftId: state.draftId ?? undefined, conversationId: state.conversationId, customerId: state.customerId, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, version, items: state.items, subtotal, deliveryFee, total: subtotal + deliveryFee, address: state.address, addressConfirmed: state.addressConfirmed, deliveryQuoteAuditId, deliveryQuoteVersion, deliveryQuoteExpiresAt, availabilitySnapshot: availability, allowNewDraftAfterConfirm: options.allowNewDraftAfterConfirm });
    return {
      ...state,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliveryQuoteAuditId,
      deliveryQuoteVersion,
      deliveryQuoteExpiresAt: deliveryQuoteExpiresAt?.toISOString() ?? null,
      deliveryQuoteDestinationBinding,
      availabilitySnapshot: availability,
      draftId: saved.id,
      draftVersion: saved.version,
      draftHash: saved.draftHash,
      // A22 CLOSURE: record the fulfillment this draft was ACTUALLY (re)prepared/priced for, at the
      // exact moment draftId/draftVersion/draftHash were (re)computed. See field doc in
      // `commercial.types.ts`.
      draftFulfillment: state.fulfillment,
      // A24 CLOSURE: record the items/paymentPreference this draft was ACTUALLY (re)prepared/priced
      // for, at the exact moment draftId/draftVersion/draftHash were (re)computed. See field docs in
      // `commercial.types.ts`.
      draftItemsFingerprint: commercialItemsFingerprint(state.items),
      draftPaymentPreference: state.paymentPreference,
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

  private async confirm(
    state: CommercialConversationState,
    command: CommercialMessageCommand,
    previous: CommercialConversationState,
    turnDelta: { parsed: CommercialParsedMessage; acceptCoordinates: boolean },
  ): Promise<CommercialTurnResult> {
    if (state.lastQuestionPurpose !== 'CONFIRM_ORDER' || !state.draftId || !state.draftVersion || !state.draftHash || !state.expiresAt) return this.handoff(state, command, 'SOFIA_CONTEXTUAL_CONFIRMATION_INVALID');
    // QUOTE BINDING (SOFIA Round 5 / A10): a single WhatsApp message can carry BOTH a CONFIRM
    // intent AND a new address/GPS in the same text (e.g. "Confirmo, mejor envíamelo a la calle 80
    // con 15"). `process()` already applied that destination edit (and, if it bumped the spatial
    // revision, called `invalidateDraft`) BEFORE routing here — but `invalidateDraft` only resets
    // `confirmationState`, which `confirm()` never even reads; the ONLY thing gating this call is
    // `lastQuestionPurpose === 'CONFIRM_ORDER'`, still true from the PRIOR turn's `prepareDraft`.
    // Without this explicit check, the stale `draftId`/`draftHash` from the OLD destination would
    // be confirmed as-is, silently applying the OLD (possibly out-of-coverage-cheaper) quote to the
    // NEW address. Fail closed: require `quote.destinationRevision == currentDestination.revision`
    // (`isQuoteBoundToCurrentDestination`) — a missing binding is treated as UNPROVEN, not "fine".
    //
    // FULFILLMENT BINDING (SOFIA Round 5 / A22 CLOSURE — CRITICAL): the exact same compound-message
    // hazard applies to FULFILLMENT, not just destination. `process()` parses `intent` and
    // `fulfillment` from the same message INDEPENDENTLY (`CommercialIntentEngine.interpret()`), so
    // "Confirmo, mejor paso por el local" yields CONFIRM + TAKEAWAY in one shot; `process()` already
    // mutated `state.fulfillment` to TAKEAWAY (and cleared address/fee/binding) BEFORE routing here,
    // but `draftId`/`draftVersion`/`draftHash` still point at the PRIOR turn's real, priced DELIVERY
    // draft. The OLD destination-binding-only check above was blind to this: `state.fulfillment !==
    // 'DELIVERY'` short-circuited it to trivially `true` the instant fulfillment stopped being
    // DELIVERY, regardless of what the persisted draft actually was. `draftFulfillment` (captured by
    // `prepareDraft()` at the moment the draft was last actually priced/persisted) lets us tell "this
    // conversation was ALREADY this fulfillment" (safe, cheap fast path — no destination data to
    // check for a conversation that was TAKEAWAY the whole time) apart from "fulfillment just
    // changed THIS turn, bundled with confirm" (unsafe — the draft about to be confirmed no longer
    // represents current reality). Fail closed: a mismatch invalidates the draft exactly like an
    // address change already does, forcing `prepareDraft()` to re-derive a draft that truly matches
    // the CURRENT fulfillment before anything can be confirmed.
    const fulfillmentStillBound = state.draftFulfillment === state.fulfillment;
    const destinationStillBound = state.fulfillment !== 'DELIVERY'
      || (state.deliveryQuoteDestinationBinding !== null
        && state.destinationSnapshot !== null
        && isQuoteBoundToCurrentDestination(state.deliveryQuoteDestinationBinding, state.destinationSnapshot));
    // ITEMS BINDING (SOFIA Round 5 / A24 CLOSURE — MEDIUM): the exact same compound-message hazard
    // that motivated `fulfillmentStillBound` (A21/A22) applies to ITEMS. `process()` mutates
    // `state.items` IN MEMORY (product-mention resolution at line ~206, bare-quantity change at line
    // ~209, modifier changes) independently of intent parsing, so "Confirmo, y agregame un perro
    // caliente" / "Confirmo, mejor dos" apply the item mutation to `state.items` and THEN route
    // straight into `confirm()` in the SAME call — before any `prepareDraft()` re-derivation ever
    // prices/persists the new items. `draftItemsFingerprint` (captured by `prepareDraft()` at the
    // moment the draft was last actually priced/persisted) lets us detect this exactly like
    // `draftFulfillment` does for fulfillment. Fail closed: a mismatch invalidates the draft, forcing
    // `prepareDraft()` to re-derive (re-price) a draft that truly matches the CURRENT items before
    // anything can be confirmed.
    const itemsStillBound = state.draftItemsFingerprint === commercialItemsFingerprint(state.items);
    // PAYMENT BINDING (SOFIA Round 5 / A24 CLOSURE — MEDIUM): same hazard, PAYMENT PREFERENCE axis.
    // "Confirmo, pasame el link" yields CONFIRM + ONLINE parsed independently from the same text;
    // `process()` mutates `state.paymentPreference` IN MEMORY and THEN routes straight into
    // `confirm()`. Without this check the OLD draft (still PAY_AT_PICKUP/CASH_ON_DELIVERY on the
    // persisted row) would be confirmed verbatim while the customer is told ONLINE — silently
    // suppressing `PaymentOrchestrationService.createOnlinePaymentLink` for a customer who explicitly
    // asked for a payment link in the very message that confirmed the order.
    const paymentStillBound = state.draftPaymentPreference === state.paymentPreference;
    const quoteStillBound = fulfillmentStillBound && itemsStillBound && paymentStillBound && destinationStillBound;
    if (
      new Date(state.expiresAt) <= new Date()
      || (state.fulfillment === 'DELIVERY' && (!state.deliveryQuoteExpiresAt || new Date(state.deliveryQuoteExpiresAt) <= new Date()))
      || !quoteStillBound
    ) {
      state.confirmationState = 'EXPIRED';
      let refreshed: CommercialConversationState;
      try {
        refreshed = await this.prepareDraft(state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) });
      } catch (error) {
        const outcome = await this.recoverDraftConflict(error, state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) }, turnDelta);
        if (!outcome.recovered) throw error;
        if (outcome.kind !== 'RETRY_SUCCEEDED') return outcome.result;
        refreshed = outcome.prepared;
      }
      refreshed.confirmationState = 'PENDING';
      refreshed.lastQuestionPurpose = 'CONFIRM_ORDER';
      if (!fulfillmentStillBound) this.metrics.increment('fulfillment_quote_binding_refresh');
      else if (!itemsStillBound) this.metrics.increment('items_quote_binding_refresh');
      else if (!paymentStillBound) this.metrics.increment('payment_quote_binding_refresh');
      else if (!destinationStillBound) this.metrics.increment('destination_quote_binding_refresh');
      await this.persistAndAudit(
        refreshed,
        command,
        !fulfillmentStillBound
          ? 'SOFIA_DRAFT_FULFILLMENT_CHANGED_REFRESHED'
          : !itemsStillBound
            ? 'SOFIA_DRAFT_ITEMS_CHANGED_REFRESHED'
            : !paymentStillBound
              ? 'SOFIA_DRAFT_PAYMENT_CHANGED_REFRESHED'
              : quoteStillBound
                ? 'SOFIA_DRAFT_EXPIRED_REFRESHED'
                : 'SOFIA_DRAFT_DESTINATION_CHANGED_REFRESHED',
      );
      return this.respond(refreshed, 'QUOTE_EXPIRED', 'READY_TO_CONFIRM');
    }
    try {
      await this.validateAvailability(state);
    } catch (error) {
      if (error instanceof BadRequestException && (error.getResponse() as { code?: string }).code === 'SOFIA_PRICE_CHANGED') {
        for (const item of state.items) item.unitPrice = (await this.catalog.getActiveById(item.productId)).persistedPrice;
        let refreshed: CommercialConversationState;
        try {
          refreshed = await this.prepareDraft(state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) });
        } catch (priceRefreshError) {
          const outcome = await this.recoverDraftConflict(priceRefreshError, state, command, { allowNewDraftAfterConfirm: this.allowsNewDraftAfterConfirm(previous, state) }, turnDelta);
          if (!outcome.recovered) throw priceRefreshError;
          if (outcome.kind !== 'RETRY_SUCCEEDED') return outcome.result;
          refreshed = outcome.prepared;
        }
        refreshed.confirmationState = 'PENDING';
        refreshed.lastQuestionPurpose = 'CONFIRM_ORDER';
        await this.persistAndAudit(refreshed, command, 'SOFIA_DRAFT_PRICE_REFRESHED');
        return this.respond(refreshed, 'PRICE_CHANGED', 'READY_TO_CONFIRM');
      }
      throw error;
    }
    const confirmationHash = commercialDraftHash({ draftId: state.draftId, version: state.draftVersion, draftHash: state.draftHash, customerId: state.customerId, conversationId: state.conversationId });
    try {
      await this.repository.confirmDraft({ draftId: state.draftId, expectedVersion: state.draftVersion, expectedHash: state.draftHash, confirmationHash });
    } catch (error) {
      if (this.isStaleConfirmationConflict(error)) return this.recoverStaleConfirmation(state, command, error as ConflictException);
      throw error;
    }
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

  /**
   * Resolves the destination snapshot to treat as `previous` for this turn's `applyDestinationEdit`
   * call. Almost always just `state.destinationSnapshot` — the fallback exists ONLY for backward
   * compatibility with a `CommercialConversationState` that has `address`/`location` populated but
   * no `destinationSnapshot` yet (a conversation persisted before this snapshot-based model existed,
   * or a state constructed directly by an older/external caller). Without this, a coordinate-only or
   * instruction-only edit on such a state would see `previous === null` and silently overwrite the
   * already-known address with `null` (RULE 6 is about never inheriting ANOTHER destination's
   * evidence — it does not license discarding THIS conversation's own already-known address). This
   * reconstructs the conversation's OWN prior state only; it never reaches into another
   * conversation/customer/order.
   */
  private baselineDestinationSnapshot(state: CommercialConversationState): DestinationSnapshot | null {
    if (state.destinationSnapshot) return state.destinationSnapshot;
    if (!state.address) return null;
    return createInitialDestinationSnapshot({
      rawReferenceText: state.address,
      coordinates: state.location
        ? { latitude: state.location.latitude, longitude: state.location.longitude, source: 'GPS_SHARE', confidence: 'HIGH' }
        : null,
    });
  }

  private invalidateDraft(state: CommercialConversationState) { if (state.confirmationState === 'CONFIRMED' || state.confirmationState === 'PENDING') state.confirmationState = 'NONE'; }
  private async persistAndAudit(state: CommercialConversationState, command: CommercialMessageCommand, action: string) { await this.repository.saveState(state); await this.audit.record({ actor: command.actor, action, entity: 'sofia_commercial_conversation', entityId: state.conversationId, result: 'SUCCESS', after: { intent: state.intent, fulfillment: state.fulfillment, paymentPreference: state.paymentPreference, draftId: state.draftId, draftVersion: state.draftVersion, missingFields: state.missingFields } }); this.metrics.increment(action.includes('AMBIGUOUS') ? 'commercial_intent_ambiguous' : action.includes('DRAFT_CONFIRMED') ? 'draft_confirmed' : action.includes('DRAFT_CREATED') ? 'draft_created' : action.includes('DRAFT_UPDATED') ? 'draft_updated' : 'commercial_intent_resolved'); }
  private async handoff(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.handoffState = 'HUMAN_REQUIRED'; state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_HANDOFF_REQUESTED'); this.metrics.increment('handoff_requested'); return this.respond(state, 'HUMAN_HANDOFF', 'HANDOFF'); }
  private async dependencyFailure(state: CommercialConversationState, command: CommercialMessageCommand, code: string): Promise<CommercialTurnResult> { state.domainErrors = [code]; await this.persistAndAudit(state, command, 'SOFIA_DOMAIN_VALIDATION_FAILED'); return this.respond(state, 'DEPENDENCY_FAILURE', 'HANDOFF'); }
}
