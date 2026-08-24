/**
 * SOFIA Round 5 / A10 — SOFIA multi-turn destination-state closure.
 *
 * A9 (Round 5) built the canonical destination-state authority
 * (`../../../delivery/destination-state`) and flagged two concrete gaps in THIS file:
 *   - `commercial-checkout.service.ts` (old) line 70: `location: command.location ?? previous.location`
 *     carried a GPS point forward on every turn, even after the customer typed a different, distant
 *     textual address (HIGH finding).
 *   - lines 110-113: `state.address = parsed.address` without ever clearing/re-evaluating
 *     `state.location`, so a stale point could still reach the delivery pricing authority.
 *
 * This suite proves BOTH are closed by routing every destination-affecting signal (GPS share AND/OR
 * typed address) through `applyDestinationEdit`, and additionally proves the QUOTE BINDING invariant
 * (`quote.destinationRevision == currentDestination.revision`) and the out-of-order GPS replay guard
 * this round requires, end to end through `CommercialCheckoutService.process()` — not just at the
 * pure-function unit level (see `../../../delivery/destination-state/destination-revision.spec.ts`
 * for that layer, owned by A9).
 */

import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';
import type { CommercialConversationState, CommercialMessageCommand } from './commercial.types';

const engine = new CommercialIntentEngine();
const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

const NEAR = { latitude: 3.26, longitude: -76.54 }; // ~store, in coverage
const NEAR_B = { latitude: 3.261, longitude: -76.539 }; // distinct nearby point (Scenario C "GPS B")
const FAR = { latitude: 3.62, longitude: -76.15 }; // ~42km away, out of coverage

function emptyState(conversationId: string): CommercialConversationState {
  return {
    schemaVersion: 4, conversationId, customerId: null, intent: 'UNKNOWN', items: [], fulfillment: null, address: null, addressConfirmed: false, location: null,
    destinationSnapshot: null, deliveryQuoteDestinationBinding: null,
    paymentPreference: 'UNKNOWN', paymentReadiness: 'PAYMENT_UNRESOLVED', subtotal: null, deliveryFee: null, total: null, deliveryQuoteAuditId: null,
    deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [], draftId: null, draftVersion: null,
    draftHash: null, draftFulfillment: null, draftItemsFingerprint: null, draftPaymentPreference: null, confirmationState: 'NONE',
    missingFields: [], ambiguities: [], confidence: 'LOW', handoffState: 'SOFIA_ACTIVE', consentState: 'SERVICE',
    domainErrors: [], lastQuestionPurpose: null, lastResolvedIntent: null, expiresAt: null,
  };
}

function isFarPoint(latitude?: number, longitude?: number) {
  return latitude != null && longitude != null && Math.abs(latitude - FAR.latitude) < 0.001 && Math.abs(longitude - FAR.longitude) < 0.001;
}

function buildQuoteMock() {
  let counter = 0;
  return jest.fn(async (input: { addressText?: string; latitude?: number; longitude?: number; orderSubtotal: number }) => {
    const hasCoords = input.latitude != null && input.longitude != null;
    if (isFarPoint(input.latitude, input.longitude)) {
      return { auditId: null, status: 'OUT_OF_COVERAGE', finalFee: null, currency: 'COP' as const, distanceKm: 42, estimatedMinutes: null, reasonCode: 'OUT_OF_COVERAGE', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: false };
    }
    counter += 1;
    return {
      auditId: `audit-${counter}`,
      status: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
      finalFee: hasCoords ? 5000 : 0,
      currency: 'COP' as const,
      distanceKm: hasCoords ? 4 : 0,
      estimatedMinutes: 20,
      reasonCode: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
      calculationVersion: '2x1-delivery-pricing-v1',
      canCheckout: true,
    };
  });
}

function buildService(quote = buildQuoteMock()) {
  const states = new Map<string, CommercialConversationState>();
  const drafts = new Map<string, { id: string; version: number; draftHash: string; expiresAt: Date; status: string }>();
  let draftCounter = 0;
  const repository = {
    loadState: jest.fn(async (conversationId: string) => states.get(conversationId) ?? null),
    saveState: jest.fn(async (next: CommercialConversationState) => { states.set(next.conversationId, structuredClone(next)); }),
    saveDraft: jest.fn(async (input: Record<string, unknown> & { conversationId: string; version?: number; draftId?: string }) => {
      const id = input.draftId ?? `draft-${++draftCounter}`;
      const version = input.version ?? 1;
      const draftHash = `hash-${id}-${version}`;
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      const record = { id, version, draftHash, expiresAt, status: 'READY_TO_CONFIRM' };
      drafts.set(id, record);
      return record;
    }),
    confirmDraft: jest.fn(async (input: { draftId: string; expectedVersion: number; expectedHash: string }) => {
      const record = drafts.get(input.draftId);
      if (!record || record.version !== input.expectedVersion || record.draftHash !== input.expectedHash) {
        throw Object.assign(new Error('SOFIA_STALE_CONFIRMATION'), { response: { code: 'SOFIA_STALE_CONFIRMATION' } });
      }
      record.status = 'CONFIRMED';
      return { id: record.id, version: record.version, status: 'CONFIRMED' };
    }),
  };
  const product = {
    id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
    category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
    active: true, trackStock: true, updatedAt: new Date().toISOString(),
  };
  const responses = new CommercialResponseComposer(
    { compose: jest.fn(async () => null) },
    new CommercialResponseValidator(),
    new SafeCommercialResponseTemplates(),
  );
  const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
  const metrics = new CommercialMetricsService();
  const service = new CommercialCheckoutService(
    engine, new CommercialPolicyService(), metrics, responses, repository as never,
    { listActive: jest.fn(async () => [product]), getActiveById: jest.fn(async () => product), findActive: jest.fn() } as never,
    { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
    { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
    { resolve: jest.fn(async () => ({ customerId: 'c1', displayName: null, phoneMasked: '***', created: false })) } as never,
    { quote } as never,
    { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
    orderCreation as never,
  );
  return { service, repository, quote, metrics, states, seed: (state: CommercialConversationState) => states.set(state.conversationId, state) };
}

function send(service: CommercialCheckoutService, conversationId: string, message: string, extra: Partial<CommercialMessageCommand> = {}) {
  return service.process({ conversationId, phone: '573001112233', message, actor, ...extra });
}

describe('SOFIA multi-turn destination state (Round 5 / A10)', () => {
  describe('Scenario A — GPS then a distant textual address', () => {
    it('GPS A (near) -> "envíamelo a [distant B]" bumps the destination revision, GPS A never reaches the new quote, requote is forced', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-a', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      expect(quote.mock.calls[0]![0]).toMatchObject({ latitude: NEAR.latitude, longitude: NEAR.longitude });

      const second = await send(service, 'conv-a', 'mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');
      // The new address is FAR from the store per the mock quote's distance heuristic.
      // GPS A must NOT be forwarded for this address — no `latitude`/`longitude` at all.
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBeUndefined();
      expect(lastCall.longitude).toBeUndefined();
      expect(second.state.address).toContain('Avenida 9');
      expect(second.state.location).toBeNull();
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('STALE');
      expect(second.state.destinationSnapshot?.revision).toBe(2);
    });
  });

  describe('Scenario B — GPS then a delivery-instruction-only follow-up', () => {
    it('GPS A remains valid and reaches the quote after a non-spatial instruction message', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-b', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const first = quote.mock.calls[0]![0];
      expect(first.latitude).toBe(NEAR.latitude);

      // A pure delivery-instruction message: no street keyword, no digit -> `parsed.address` stays
      // null (see `commercial-intent.engine.ts`'s address regex), so the destination-edit block does
      // not even run — the snapshot (and GPS A) is untouched.
      const second = await send(service, 'conv-b', 'la casa tiene porton negro, avisa cuando llegues');
      expect(second.state.destinationSnapshot?.revision).toBe(1);
      expect(second.state.location).toEqual(NEAR);
    });
  });

  describe('Scenario C — GPS A then GPS B for the same address', () => {
    it('GPS B supersedes GPS A; GPS A is never used once GPS B is bound', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-c', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const afterGpsB = await send(service, 'conv-c', 'pago cuando llegue', { location: NEAR_B });
      expect(afterGpsB.state.destinationSnapshot?.revision).toBe(1); // same address, no spatial bump
      expect(afterGpsB.state.location).toEqual(NEAR_B);
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBe(NEAR_B.latitude);
      expect(lastCall.longitude).toBe(NEAR_B.longitude);
    });
  });

  describe('Scenario D — out-of-order GPS replay', () => {
    it('a delayed replay of the OLD (now-stale) GPS after the address changed is rejected, not silently rebound', async () => {
      const { service, quote, metrics } = buildService();
      await send(service, 'conv-d', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      await send(service, 'conv-d', 'mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');

      // A delayed re-delivery of the ORIGINAL GPS A event arrives now, after the address moved on.
      const replay = await send(service, 'conv-d', 'pago cuando llegue', { location: NEAR });
      expect(replay.state.destinationSnapshot?.coordinateTrust).toBe('STALE');
      expect(replay.state.destinationSnapshot?.latitude).toBe(NEAR.latitude);
      expect(replay.state.location).toBeNull(); // never silently promoted back to usable
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBeUndefined();
      expect(metrics.snapshot().stale_coordinate_replay_rejected).toBe(1);
    });

    it('a genuinely FRESH, different GPS point after an address change is still accepted (the guard is narrow)', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-d2', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      await send(service, 'conv-d2', 'mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');
      const freshShare = await send(service, 'conv-d2', 'pago cuando llegue', { location: NEAR_B });
      expect(freshShare.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      expect(freshShare.state.location).toEqual(NEAR_B);
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBe(NEAR_B.latitude);
    });
  });

  describe('Idempotency', () => {
    it('duplicate GPS message: resending the same point twice is a no-op (same revision, still trusted)', async () => {
      const { service } = buildService();
      const first = await send(service, 'conv-dup-gps', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const second = await send(service, 'conv-dup-gps', 'pago cuando llegue', { location: NEAR });
      expect(second.state.destinationSnapshot?.revision).toBe(first.state.destinationSnapshot?.revision);
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      expect(second.state.location).toEqual(NEAR);
    });

    it('duplicate address message: resending the exact same address text does not bump the revision', async () => {
      const { service } = buildService();
      const first = await send(service, 'conv-dup-addr', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const second = await send(service, 'conv-dup-addr', 'Confirmo que es a la Carrera 10 # 20 y pago cuando llegue');
      expect(second.state.destinationSnapshot?.revision).toBe(first.state.destinationSnapshot?.revision);
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
    });
  });

  describe('RULE 6 — cross-order / cross-conversation isolation', () => {
    it('GPS bound to one conversation (order) never leaks into a brand new conversation (a new order)', async () => {
      const { service } = buildService();
      const previousOrder = await send(service, 'conv-order-1', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      expect(previousOrder.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      const fresh = await send(service, 'conv-order-2', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue');
      expect(fresh.state.destinationSnapshot?.revision).toBe(1);
      expect(fresh.state.location).toBeNull();
      expect(fresh.state.destinationSnapshot?.coordinateTrust).toBe('UNTRUSTED');
    });

    it('a new conversation never inherits a previous conversation\'s destinationSnapshot object identity', async () => {
      const { service } = buildService();
      const withHistory = await send(service, 'conv-restart-old', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      expect(withHistory.state.destinationSnapshot).not.toBeNull();
      const restarted = await send(service, 'conv-restart-new', 'pago cuando llegue');
      expect(restarted.state.destinationSnapshot).toBeNull();
    });
  });

  describe('Normalization and identity', () => {
    it('a harmless casing/whitespace difference in the same address does not force an unnecessary revision bump', async () => {
      const { service } = buildService();
      const first = await send(service, 'conv-norm', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const second = await send(service, 'conv-norm', 'Confirmo, es a la   carrera   10   #   20  y pago cuando llegue');
      expect(second.state.destinationSnapshot?.revision).toBe(first.state.destinationSnapshot?.revision);
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
    });

    it('a Unicode NFD-vs-NFC equivalent address is treated as the SAME destination (no spurious invalidation)', async () => {
      const { service } = buildService();
      const nfc = 'Carrera 10 #20 Cañón'; // NFC (precomposed ñ)
      const nfd = 'Carrera 10 #20 Cañón'.normalize('NFD'); // combining tilde + acute, decomposed
      const first = await send(service, 'conv-unicode', `Mándame un combo 2x1 a la ${nfc} y pago cuando llegue`, { location: NEAR });
      const second = await send(service, 'conv-unicode', `Confirmo que es a la ${nfd} y pago cuando llegue`);
      expect(second.state.destinationSnapshot?.revision).toBe(first.state.destinationSnapshot?.revision);
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
    });

    it('a homoglyph-altered address (Cyrillic lookalike) fails closed as a DIFFERENT destination, invalidating stale GPS', async () => {
      const { service } = buildService();
      // The street keyword itself ("Carrera") is kept ASCII so `commercial-intent.engine.ts`'s
      // address-capture regex still recognizes this as an address at all (that regex is a fixed
      // upstream dependency, out of this round's scope) — the homoglyph is planted later in the
      // SAME captured text: Cyrillic "е" (U+0435) substituted for Latin "e" (U+0065) in "Centro".
      const homoglyph = 'Carrera 10 # 20 barrio Cеntro';
      const first = await send(service, 'conv-homoglyph', 'Mándame un combo 2x1 a la Carrera 10 # 20 barrio Centro y pago cuando llegue', { location: NEAR });
      expect(first.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      const second = await send(service, 'conv-homoglyph', `Confirmo que es a la ${homoglyph} y pago cuando llegue`);
      expect(second.state.destinationSnapshot?.spatialFingerprint).not.toBe(first.state.destinationSnapshot?.spatialFingerprint);
      expect(second.state.destinationSnapshot?.revision).toBe((first.state.destinationSnapshot?.revision ?? 0) + 1);
      expect(second.state.destinationSnapshot?.coordinateTrust).toBe('STALE');
      expect(second.state.location).toBeNull();
    });
  });

  describe('Trusted evidence supersedes stale evidence, never a bypass', () => {
    it('near GPS + a later, different (far, alias-styled) textual address: the stale near-GPS is withheld from the new quote', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-near-far', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const changed = await send(service, 'conv-near-far', 'mejor envíamelo para la Avenida 9 #50-30 barrio alborada y pago cuando llegue');
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBeUndefined();
      expect(lastCall.longitude).toBeUndefined();
      expect(changed.state.location).toBeNull();
    });

    it('far GPS + a local-free-styled reference: the real trusted point still reaches the quote and correctly blocks checkout (no text-only bypass)', async () => {
      const { service, quote } = buildService();
      await expect(
        send(service, 'conv-far-alias', 'Mándame un combo 2x1 a la Carrera 10 # 20 barrio alborada y pago cuando llegue', { location: FAR }),
      ).rejects.toMatchObject({ response: { code: 'SOFIA_DELIVERY_QUOTE_REQUIRED' } });
      // The real (far) point reached the pricing authority — it was never silently dropped in favor
      // of the cheap "barrio alborada" text-only alias match.
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBe(FAR.latitude);
      expect(lastCall.longitude).toBe(FAR.longitude);
    });

    it('a trusted MAP_PIN location for the old address becomes stale once the customer types a different address', async () => {
      const seeded = emptyState('conv-map-pin');
      seeded.fulfillment = 'DELIVERY';
      seeded.paymentPreference = 'CASH_ON_DELIVERY';
      seeded.items = [{ productId: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', quantity: 1, unitPrice: 25000, modifiers: [] }];
      seeded.address = 'Carrera 10 # 20';
      seeded.addressConfirmed = true;
      seeded.location = NEAR;
      seeded.destinationSnapshot = {
        revision: 1,
        spatialFingerprint: 'sha256:seed',
        normalizedAddress: 'carrera 10 20',
        addressComponents: null,
        latitude: NEAR.latitude,
        longitude: NEAR.longitude,
        coordinateSource: 'MAP_PIN',
        coordinateTrust: 'TRUSTED',
        coordinateBoundRevision: 1,
        geocodingProvider: null,
        geocodingEvidenceId: null,
        deliveryInstructions: null,
        referenceText: 'Carrera 10 # 20',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { service, quote, seed } = buildService();
      seed(seeded);
      const result = await send(service, 'conv-map-pin', 'mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');
      expect(result.state.destinationSnapshot?.coordinateTrust).toBe('STALE');
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBeUndefined();
    });
  });

  describe('QUOTE BINDING — confirm() must never trust a draft priced against a superseded destination', () => {
    it('sequential turns: changing the address after CONFIRMED forces a fresh quote/draft, and the eventual re-confirmation is bound to the NEW destination, never a silent replay of the OLD one', async () => {
      const { service } = buildService();
      await send(service, 'conv-seq', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const confirmed = await send(service, 'conv-seq', 'Confirmo');
      expect(confirmed.nextAction).toBe('DRAFT_CONFIRMED');
      const originalQuoteAuditId = confirmed.state.deliveryQuoteAuditId;
      const originalRevision = confirmed.state.destinationSnapshot?.revision;

      // Address changes to a DIFFERENT destination AFTER the order was already confirmed.
      const changed = await send(service, 'conv-seq', 'mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');
      // `invalidateDraft` must have fired (destination revision bumped) — the conversation is never
      // left silently "CONFIRMED" for a destination that no longer matches what the customer typed.
      expect(changed.state.confirmationState).not.toBe('CONFIRMED');
      expect(changed.state.destinationSnapshot?.revision).toBe((originalRevision ?? 0) + 1);

      const reconfirmed = await send(service, 'conv-seq', 'Sí');
      expect(reconfirmed.nextAction).toBe('DRAFT_CONFIRMED');
      // The FINAL confirmation is bound to the NEW destination — a fresh quote, never the OLD
      // (Carrera 10) audit id silently carried through to the customer's actual confirmation.
      expect(reconfirmed.state.deliveryQuoteAuditId).not.toBe(originalQuoteAuditId);
      expect(reconfirmed.state.address).toContain('Avenida 9');
    });

    it('compound message: "Confirmo, mejor a [new distant address]" in ONE message must never confirm the OLD draft/quote', async () => {
      const { service } = buildService();
      // Turn 1 leaves the draft READY_TO_CONFIRM (PENDING, `lastQuestionPurpose === 'CONFIRM_ORDER'`)
      // but NOT yet actually confirmed — this is the exact window where a single message can carry
      // BOTH the CONFIRM intent AND a new address, and `confirm()`'s pre-existing
      // `lastQuestionPurpose` gate alone would NOT catch it (that gate only rejects when the
      // customer's PRIOR turn wasn't already at "ready to confirm"). Only the QUOTE BINDING check
      // (`isQuoteBoundToCurrentDestination`) stands between this message and confirming the STALE
      // Carrera-10 draft/quote under the NEW Avenida address.
      const ready = await send(service, 'conv-compound', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      const originalQuoteAuditId = ready.state.deliveryQuoteAuditId;
      const originalDraftVersion = ready.state.draftVersion;
      const originalRevision = ready.state.destinationSnapshot?.revision;

      const compound = await send(service, 'conv-compound', 'Confirmo, mejor envíamelo para la Avenida 9 #50-30 y pago cuando llegue');
      // Must NOT be a silent DRAFT_CONFIRMED reusing the OLD (Carrera 10) draft/quote binding —
      // the QUOTE BINDING check inside `confirm()` must force a fresh `prepareDraft` instead.
      expect(compound.nextAction).not.toBe('DRAFT_CONFIRMED');
      expect(compound.state.address).toContain('Avenida 9');
      expect(compound.state.destinationSnapshot?.revision).toBe((originalRevision ?? 0) + 1);
      expect(compound.state.deliveryQuoteAuditId).not.toBe(originalQuoteAuditId);
      expect(compound.state.draftVersion).toBeGreaterThan(originalDraftVersion ?? 0);
    });

    it('new trusted geocode-equivalent evidence for a revised (same-turn) address is accepted as fresh evidence for the new revision', async () => {
      const { service, quote } = buildService();
      await send(service, 'conv-revised', 'Mándame un combo 2x1 a la Carrera 10 # 20 y pago cuando llegue', { location: NEAR });
      const revised = await send(service, 'conv-revised', 'mejor envíamelo para la Avenida 50 #10-10 y pago cuando llegue', { location: NEAR_B });
      expect(revised.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      expect(revised.state.destinationSnapshot?.coordinateBoundRevision).toBe(revised.state.destinationSnapshot?.revision);
      const lastCall = quote.mock.calls[quote.mock.calls.length - 1]![0];
      expect(lastCall.latitude).toBe(NEAR_B.latitude);
    });
  });
});
