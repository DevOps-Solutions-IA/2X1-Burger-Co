/**
 * SOFIA Round 5 / A21 — BLIND independent red team pass (fresh audit of
 * feat/sofia-remediation-address-round5-20-materialization-fix, no prior context beyond the public
 * mission brief). Four previous rounds (A9/A10, A13/A14, A15/A16, A17/A18, A19/A20) each closed a
 * distinct gap in "does every code path agree on what counts as trustworthy evidence that the
 * destination genuinely changed / was genuinely priced". A21 found a FIFTH, DIFFERENT gap in the
 * SAME general family, but on an axis none of the prior rounds' fixes touched: FULFILLMENT TYPE
 * (DELIVERY vs TAKEAWAY), not address/coordinates.
 *
 * SOFIA Round 5 / A22 — REMEDIATION + PERMANENT REGRESSION (this file, updated in place). The
 * original A21 bug report is preserved below verbatim for provenance; the test bodies have been
 * converted from "prove the attack succeeds" to "prove the attack is now blocked / safely
 * requoted" — i.e. this file now asserts the FIXED behavior permanently, not the vulnerability.
 *
 * ============================== ORIGINAL A21 BUG REPORT (for provenance) ==============================
 * THE BUG: `CommercialCheckoutService.confirm()`'s ONLY defense against confirming a STALE quote
 * bound to a DIFFERENT destination was `quoteStillBound` (`commercial-checkout.service.ts`, ~line
 * 341-344, PRE-FIX):
 *
 *   const quoteStillBound = state.fulfillment !== 'DELIVERY'
 *     || (state.deliveryQuoteDestinationBinding !== null && state.destinationSnapshot !== null
 *         && isQuoteBoundToCurrentDestination(...));
 *
 * The FIRST clause (`state.fulfillment !== 'DELIVERY'`) short-circuited the whole check to `true`
 * ("trivially bound, nothing to validate") whenever fulfillment was NOT DELIVERY at confirm() time.
 * That is correct for a conversation that has been TAKEAWAY the whole time. It was WRONG when
 * fulfillment JUST CHANGED, in THIS SAME TURN, from DELIVERY to TAKEAWAY — because `process()`
 * evaluates `parsed.fulfillment` and `parsed.intent` from the SAME message INDEPENDENTLY
 * (`commercial-intent.engine.ts`: two separate regex tests over the same normalized text, with no
 * interaction between them), so a single, entirely realistic Spanish message like "Confirmo, mejor
 * paso por el local" produces `intent: 'CONFIRM'` AND `fulfillment: 'TAKEAWAY'` in one shot.
 * `process()` applies the fulfillment switch (clearing `state.address`/`state.deliveryFee`/
 * `state.deliveryQuoteAuditId`/`state.deliveryQuoteDestinationBinding` IN MEMORY ONLY) and THEN
 * routes straight to `confirm()` in the same call (no intermediate turn).
 *
 * `confirm()` did NOT re-derive `state.draftId`/`draftVersion`/`draftHash` from the just-updated
 * `state.fulfillment` — it reused whatever `state.draftId` already pointed at from the PRIOR turn's
 * `prepareDraft()`. That prior draft is a real, already-priced DELIVERY draft (real address, real
 * positive delivery fee, real linked `DeliveryPricingAudit` row). Because `quoteStillBound` was
 * trivially `true` (fulfillment read TAKEAWAY at the moment of the check), NONE of the
 * expiry/requote branch conditions fired, and `confirm()` proceeded straight to
 * `repository.confirmDraft(...)` — which transitioned the OLD DELIVERY draft ROW to CONFIRMED status
 * VERBATIM, never touching `fulfillment`/`deliveryFee`/`deliveryAddress`.
 *
 * CONSEQUENCE (pre-fix): the persisted, CONFIRMED `SofiaOrderDraft` — the exact row
 * `OrderCreationService.createFromSofiaDraft()` reads to materialize the real order — still said
 * DELIVERY, with the OLD address and the OLD nonzero delivery fee, while the customer was told
 * TAKEAWAY_CONFIRMED. A courier could be dispatched to a withdrawn address and/or the customer
 * charged a delivery fee for a pickup order.
 *
 * A21 confirmed the bug was one-directional: TAKEAWAY->DELIVERY bundled with confirm was already
 * safely blocked (`deliveryQuoteDestinationBinding` is null in that direction, so the pre-existing
 * DELIVERY-branch check correctly failed). Only DELIVERY->TAKEAWAY was unguarded.
 * ============================================================================================
 *
 * ============================== A22 FIX (see commercial-checkout.service.ts) ==============================
 * `CommercialConversationState.draftFulfillment` now records the fulfillment that was ACTUALLY
 * current when `draftId`/`draftVersion`/`draftHash` were last (re)computed by `prepareDraft()` —
 * mirroring the exact pattern `deliveryQuoteDestinationBinding` already established for the
 * destination axis (A9/A10). `confirm()`'s guard is now:
 *
 *   const fulfillmentStillBound = state.draftFulfillment === state.fulfillment;
 *   const destinationStillBound = state.fulfillment !== 'DELIVERY' || (... isQuoteBoundToCurrentDestination ...);
 *   const quoteStillBound = fulfillmentStillBound && destinationStillBound;
 *
 * A mismatch on EITHER axis now invalidates the draft and forces a `prepareDraft()` re-derivation
 * (same requote/re-confirm path already used for destination changes and price changes) instead of
 * confirming a stale row. A conversation that was TAKEAWAY (or DELIVERY) from the very start, with no
 * same-turn switch, still takes the cheap fast path — `draftFulfillment === state.fulfillment` holds,
 * so no destination-binding data is required for a conversation that never had any.
 * ============================================================================================
 *
 * Real Postgres (isolated `_test` database), real unmocked `CommercialCheckoutService` +
 * `CommercialIntentEngine` + `CommercialPolicyService` + `PrismaCommercialRepository` +
 * `DeliveryPricingService` + `DeliveryExternalDataService` (real audit persistence, real FK-backed
 * `SofiaOrderDraft`/`WhatsappConversation`/`Customer` rows) — only the routing/weather HTTP-provider
 * layer is doubled, matching every precedent Round 5 real-engine fixture (A11-A21). `orderCreation`
 * (SecureCommand `SOFIA_CREATE_ORDER` bridge) is a spy, not because it needs mocking for this bug —
 * the bug/fix is fully proven from the persisted `SofiaOrderDraft` row alone — but to observe exactly
 * which `draftId` a real SecureCommand dispatch would be told to materialize, and to prove it is
 * NEVER invoked for a turn that was correctly blocked/requoted rather than confirmed.
 */

import { PrismaClient } from '@prisma/client';
import { CommercialCheckoutService } from '../modules/sofia/commercial/commercial-checkout.service';
import { CommercialIntentEngine } from '../modules/sofia/commercial/commercial-intent.engine';
import { CommercialMetricsService } from '../modules/sofia/commercial/commercial-metrics.service';
import { CommercialPolicyService } from '../modules/sofia/commercial/commercial-policy.service';
import { CommercialResponseComposer } from '../modules/sofia/commercial/response/commercial-response.composer';
import { CommercialResponseValidator } from '../modules/sofia/commercial/response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from '../modules/sofia/commercial/response/safe-commercial-response.templates';
import { PrismaCommercialRepository } from '../modules/sofia/commercial/persistence/prisma-commercial.repository';
import { AuthoritativeDeliveryQuoteAdapter } from '../delivery/delivery-quote.adapter';
import { DeliveryPricingService } from '../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../delivery/providers/in-memory-external-cache';
import type { RouteResult, WeatherResult } from '../delivery/providers/provider-types';
import type { RoutingProvider } from '../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../delivery/providers/weather-provider.interface';
import type { CommercialMessageCommand } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A21/A22 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

const origin = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };
const NEAR_LATITUDE = 3.255; // ~2km, in-coverage / AUTO_PRICED, real positive fee
const NEAR_LONGITUDE = -76.545;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-24T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const isNear = Math.abs(request.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - NEAR_LONGITUDE) < 1e-6;
    const distanceKm = isNear ? 2 : 77;
    const result: RouteResult = { provider: 'mock-route', distanceKm, durationMinutes: 15, routeConfidence: 'HIGH', warnings: [] };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

function cmd(conversationId: string, message: string, location?: { latitude: number; longitude: number }): CommercialMessageCommand {
  return { conversationId, message, phone: '573009876543', displayName: 'Cliente A21A22', actor, location };
}

describe('A21/A22 Round 5 — single-message "confirmo" + fulfillment switch (both directions): the FIX now blocks/requotes instead of confirming a stale draft', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a21-fulfillment-switch-' } } }).catch(() => undefined);
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a21-fulfillment-switch-' } } }).catch(() => undefined);
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a21-fulfillment-switch-' } } }).catch(() => undefined);
    await prisma.deliveryPricingAudit.deleteMany({}).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A21A22' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  function buildService(customerId: string) {
    const repository = new PrismaCommercialRepository(prisma as never);
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true, origin, cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(), routingProvider: buildRoutingProvider(),
    });
    // REAL pricing authority — same engine legacy POS and SOFIA both use. Real Postgres audit sink
    // (SofiaOrderDraft.deliveryQuoteAuditId is a real FK to delivery_pricing_audits.id).
    const pricingService = new DeliveryPricingService(externalDataService, prisma as never);
    const quoteAdapter = new AuthoritativeDeliveryQuoteAdapter(pricingService);
    const product = {
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const responses = new CommercialResponseComposer({ compose: jest.fn(async () => null) }, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    // Spy, not a functional mock: this test proves its assertions purely from the persisted
    // SofiaOrderDraft row plus how many times a real SecureCommand(SOFIA_CREATE_ORDER) dispatch would
    // have been triggered — it must be zero for any turn that was correctly blocked/requoted.
    const orderCreation = { createFromSofiaDraft: jest.fn(async (input: { draftId: string }) => ({ id: `checkout-${input.draftId}`, replayed: false })) };
    const metrics = new CommercialMetricsService();
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), metrics, responses, repository as never,
      { listActive: jest.fn(async () => [product]), getActiveById: jest.fn(async () => product), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId, displayName: null, phoneMasked: '***', created: false })) } as never,
      quoteAdapter as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, pricingService, orderCreation };
  }

  it(
    'FIXED: "Confirmo, mejor paso por el local" in ONE message (CONFIRM intent + TAKEAWAY fulfillment ' +
      'parsed independently from the same text, DELIVERY -> TAKEAWAY) no longer confirms the OLD ' +
      'DELIVERY draft verbatim — it is blocked/requoted, and only a SUBSEQUENT honest "confirmo" ' +
      'confirms a TRUE TAKEAWAY draft with fee=0 and no address',
    async () => {
      const conversationId = `a21-fulfillment-switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009876543', provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A21A22' } });

      const { service, orderCreation } = buildService(customer.id);

      // Turn 1: item + DELIVERY + COD payment + address text + real NEAR GPS share -> READY_TO_CONFIRM
      // through the REAL pricing engine (AUTO_PRICED, real positive fee, real linked audit row).
      const ready = await service.process(
        cmd(conversationId, 'Mándame un combo 2x1 a la Avenida 9 #50-30 y pago cuando llegue', { latitude: NEAR_LATITUDE, longitude: NEAR_LONGITUDE }),
      );
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('DELIVERY');
      expect(ready.state.deliveryFee).toBeGreaterThan(0); // real AUTO_PRICED fee, never LOCAL_FREE/0
      expect(ready.state.lastQuestionPurpose).toBe('CONFIRM_ORDER');
      expect(ready.state.draftFulfillment).toBe('DELIVERY');
      const originalFee = ready.state.deliveryFee!;
      const originalAddress = ready.state.address;
      const originalAuditId = ready.state.deliveryQuoteAuditId;
      const originalDraftId = ready.state.draftId!;
      expect(originalDraftId).toBeTruthy();
      expect(originalAuditId).toBeTruthy();

      const draftBeforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftBeforeAttack.status).toBe('READY_TO_CONFIRM');
      expect(draftBeforeAttack.fulfillment).toBe('DELIVERY');
      expect(Number(draftBeforeAttack.deliveryFee)).toBe(originalFee);
      expect(draftBeforeAttack.deliveryAddress).toBe(originalAddress);

      // Turn 2 (THE ATTACK): a single, entirely ordinary Spanish message that both confirms AND
      // switches fulfillment to TAKEAWAY. No new address, no new GPS, no separate turns — one
      // message. A completely realistic thing for a customer to type.
      const attackResult = await service.process(cmd(conversationId, 'Confirmo, mejor paso por el local'));

      // FIX: the in-memory/response layer reflects TAKEAWAY (correct, unchanged from before)...
      expect(attackResult.state.fulfillment).toBe('TAKEAWAY');
      // ...but confirmation is now BLOCKED, not granted: the mismatch between the just-changed
      // fulfillment and the draft's recorded `draftFulfillment` (still DELIVERY, from turn 1) forces
      // a re-derivation instead of confirming the stale row.
      expect(attackResult.state.confirmationState).toBe('PENDING');
      expect(attackResult.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
      expect(attackResult.nextAction).toBe('READY_TO_CONFIRM');
      expect(attackResult.state.draftFulfillment).toBe('TAKEAWAY'); // re-prepared draft now correctly bound to TAKEAWAY
      expect(attackResult.state.deliveryFee).toBe(0);
      expect(attackResult.state.address).toBeNull();

      // SecureCommand(SOFIA_CREATE_ORDER) must NEVER have been reached for this turn — nothing was
      // actually confirmed.
      expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

      // Reload the draft fresh from Postgres, independent of anything this process() call chain
      // claimed in memory — the SAME draftId was re-prepared in place (new version), not confirmed.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('READY_TO_CONFIRM'); // NOT confirmed — this is the fix
      expect(draftAfterAttack.fulfillment).toBe('TAKEAWAY'); // now correctly re-priced as TAKEAWAY
      expect(Number(draftAfterAttack.deliveryFee)).toBe(0);
      expect(draftAfterAttack.deliveryAddress).toBeNull();
      expect(Number(draftAfterAttack.total)).toBe(25000); // item only, no stale delivery fee baked in

      // Turn 3: an HONEST follow-up "confirmo" (the customer re-confirming what they were actually
      // just told/asked to re-confirm) now succeeds, and persists a TRUE TAKEAWAY confirmation.
      const secondConfirm = await service.process(cmd(conversationId, 'confirmo'));
      expect(secondConfirm.nextAction).toBe('DRAFT_CONFIRMED');
      expect(secondConfirm.factEnvelope.responsePurpose).toBe('TAKEAWAY_CONFIRMED');
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draftAfterHonestConfirm = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterHonestConfirm.status).toBe('CONFIRMED');
      expect(draftAfterHonestConfirm.fulfillment).toBe('TAKEAWAY');
      expect(Number(draftAfterHonestConfirm.deliveryFee)).toBe(0);
      expect(draftAfterHonestConfirm.deliveryAddress).toBeNull();
      // *** No more DELIVERY, no more stale fee, no more stale address on the CONFIRMED row ***

      // Cross-check against what an HONEST, non-attack TAKEAWAY confirmation (never touched DELIVERY)
      // actually persists, so the fixed behavior above is not an artifact of this test's own
      // assumptions about the schema. This is the "legitimate fast path" that must remain cheap and
      // must NOT require destination-binding data it never had.
      const honestConversationId = `a21-fulfillment-switch-honest-${Date.now()}`;
      await prisma.whatsappConversation.create({ data: { id: honestConversationId, phone: '573009876544', provider: 'whatsapp_business_api' } });
      const honestCustomer = await prisma.customer.create({ data: { displayName: 'Cliente A21A22' } });
      const { service: honestService, orderCreation: honestOrderCreation } = buildService(honestCustomer.id);
      const honestReady = await honestService.process(cmd(honestConversationId, 'Quiero un combo 2x1, lo recojo yo y pago alla'));
      expect(honestReady.state.draftFulfillment).toBe('TAKEAWAY');
      const honestConfirmed = await honestService.process(cmd(honestConversationId, 'confirmo'));
      expect(honestConfirmed.nextAction).toBe('DRAFT_CONFIRMED'); // fast path: confirms in ONE more turn, no spurious requote
      expect(honestConfirmed.state.fulfillment).toBe('TAKEAWAY');
      expect(honestOrderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      const honestDraft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: honestReady.state.draftId! } });
      expect(honestDraft.fulfillment).toBe('TAKEAWAY'); // genuine takeaway confirmations DO persist TAKEAWAY
      expect(Number(honestDraft.deliveryFee)).toBe(0);
      expect(honestDraft.deliveryAddress).toBeNull();
      expect(honestDraft.status).toBe('CONFIRMED');

      // The persisted conversation MEMORY (separate table from the draft) also says TAKEAWAY/fee=0
      // for the attack conversation, consistent end-to-end after the fix.
      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { fulfillment: string; deliveryFee: number | null; confirmationState: string };
      expect(persistedState.fulfillment).toBe('TAKEAWAY');
      expect(persistedState.deliveryFee).toBe(0);
      expect(persistedState.confirmationState).toBe('CONFIRMED');

      console.log(
        `[A21/A22 FIXED] conversationId=${conversationId} draftId=${originalDraftId} ` +
          `attack turn was blocked/requoted (status stayed READY_TO_CONFIRM, fulfillment flipped to ` +
          `TAKEAWAY/fee=0/no-address); only the honest follow-up confirm actually confirmed ` +
          `CONFIRMED sofia_order_drafts.fulfillment=${draftAfterHonestConfirm.fulfillment} ` +
          `fee=${draftAfterHonestConfirm.deliveryFee} address="${draftAfterHonestConfirm.deliveryAddress}".`,
      );
    },
  );

  it(
    'SYMMETRIC ATTACK (permanent regression lock-in): "Confirmo, mejor enviamelo a <address>" in ONE ' +
      'message (CONFIRM intent + DELIVERY fulfillment parsed independently from the same text, ' +
      'TAKEAWAY -> DELIVERY) remains safely blocked/requoted after the A22 fix — A21 found this ' +
      'direction already safe (destination-binding check), this test locks that guarantee in ' +
      'permanently and additionally proves the NEW fulfillment-binding check independently blocks it too',
    async () => {
      const conversationId = `a21-fulfillment-switch-reverse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009876545', provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A21A22' } });

      const { service, orderCreation } = buildService(customer.id);

      // Turn 1: item + TAKEAWAY + pay-at-pickup -> READY_TO_CONFIRM, fee 0, no address, no
      // destination-quote binding at all (there is nothing DELIVERY-shaped to bind yet).
      const ready = await service.process(cmd(conversationId, 'Quiero un combo 2x1, lo recojo yo y pago alla'));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('TAKEAWAY');
      expect(ready.state.deliveryFee).toBe(0);
      expect(ready.state.address).toBeNull();
      expect(ready.state.draftFulfillment).toBe('TAKEAWAY');
      expect(ready.state.deliveryQuoteDestinationBinding).toBeNull();
      const originalDraftId = ready.state.draftId!;
      expect(originalDraftId).toBeTruthy();

      // Turn 2 (THE SYMMETRIC ATTACK): a single message that both confirms AND switches fulfillment
      // to DELIVERY with a brand-new address, in the same breath.
      const attackResult = await service.process(
        cmd(conversationId, 'Confirmo, mejor enviamelo a la Avenida 9 #50-30', { latitude: NEAR_LATITUDE, longitude: NEAR_LONGITUDE }),
      );

      expect(attackResult.state.fulfillment).toBe('DELIVERY');
      // Must NOT be confirmed in one shot: no destination-quote binding exists yet for a fulfillment
      // that only just became DELIVERY this turn, AND draftFulfillment (TAKEAWAY, from turn 1) no
      // longer matches state.fulfillment (DELIVERY) — either check alone would block this.
      expect(attackResult.state.confirmationState).toBe('PENDING');
      expect(attackResult.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
      expect(attackResult.nextAction).toBe('READY_TO_CONFIRM');
      expect(attackResult.state.draftFulfillment).toBe('DELIVERY'); // re-prepared draft now correctly bound to DELIVERY
      expect(attackResult.state.deliveryFee).toBeGreaterThan(0); // real AUTO_PRICED fee for the NEW address
      expect(attackResult.state.address).toBe('Avenida 9 #50-30');

      expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('READY_TO_CONFIRM'); // NOT confirmed
      expect(draftAfterAttack.fulfillment).toBe('DELIVERY');
      expect(Number(draftAfterAttack.deliveryFee)).toBeGreaterThan(0);
      expect(draftAfterAttack.deliveryAddress).toBe('Avenida 9 #50-30');

      // Turn 3: honest follow-up confirm now correctly confirms the TRUE DELIVERY draft.
      const secondConfirm = await service.process(cmd(conversationId, 'confirmo'));
      expect(secondConfirm.nextAction).toBe('DRAFT_CONFIRMED');
      expect(secondConfirm.factEnvelope.responsePurpose).toBe('DELIVERY_CONFIRMED');
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);

      const draftAfterHonestConfirm = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterHonestConfirm.status).toBe('CONFIRMED');
      expect(draftAfterHonestConfirm.fulfillment).toBe('DELIVERY');
      expect(Number(draftAfterHonestConfirm.deliveryFee)).toBeGreaterThan(0);
      expect(draftAfterHonestConfirm.deliveryAddress).toBe('Avenida 9 #50-30');
    },
  );
});
