/**
 * SOFIA Round 5 / A21 — BLIND independent red team pass (fresh audit of
 * feat/sofia-remediation-address-round5-20-materialization-fix, no prior context beyond the public
 * mission brief). Four previous rounds (A9/A10, A13/A14, A15/A16, A17/A18, A19/A20) each closed a
 * distinct gap in "does every code path agree on what counts as trustworthy evidence that the
 * destination genuinely changed / was genuinely priced". This file finds a FIFTH, DIFFERENT gap in
 * the SAME general family, but on an axis none of the prior rounds' fixes touch: FULFILLMENT TYPE
 * (DELIVERY vs TAKEAWAY), not address/coordinates.
 *
 * THE BUG: `CommercialCheckoutService.confirm()`'s ONLY defense against confirming a STALE quote
 * bound to a DIFFERENT destination is `quoteStillBound` (`commercial-checkout.service.ts`, ~line
 * 341-344):
 *
 *   const quoteStillBound = state.fulfillment !== 'DELIVERY'
 *     || (state.deliveryQuoteDestinationBinding !== null && state.destinationSnapshot !== null
 *         && isQuoteBoundToCurrentDestination(state.deliveryQuoteDestinationBinding, state.destinationSnapshot));
 *
 * The FIRST clause (`state.fulfillment !== 'DELIVERY'`) short-circuits the whole check to `true`
 * ("trivially bound, nothing to validate") whenever fulfillment is NOT DELIVERY at confirm() time.
 * That is correct for a conversation that has been TAKEAWAY the whole time. It is WRONG when
 * fulfillment JUST CHANGED, in THIS SAME TURN, from DELIVERY to TAKEAWAY — because `process()`
 * evaluates `parsed.fulfillment` and `parsed.intent` from the SAME message INDEPENDENTLY
 * (`commercial-intent.engine.ts` line 19 vs line 23-27: two separate regex tests over the same
 * normalized text, with no interaction between them), so a single, entirely realistic Spanish
 * message like "Confirmo, mejor paso por el local" produces `intent: 'CONFIRM'` AND
 * `fulfillment: 'TAKEAWAY'` in one shot. `process()` applies the fulfillment switch (clearing
 * `state.address`/`state.deliveryFee`/`state.deliveryQuoteAuditId`/`state.deliveryQuoteDestinationBinding`
 * IN MEMORY ONLY) and THEN routes straight to `confirm()` in the same call (no intermediate turn).
 *
 * `confirm()` does NOT re-derive `state.draftId`/`draftVersion`/`draftHash` from the just-updated
 * `state.fulfillment` — it reuses whatever `state.draftId` already pointed at from the PRIOR turn's
 * `prepareDraft()`. That prior draft is a real, already-priced DELIVERY draft (real address, real
 * positive delivery fee, real linked `DeliveryPricingAudit` row). Because `quoteStillBound` is now
 * trivially `true` (fulfillment reads TAKEAWAY at the moment of the check), NONE of the
 * expiry/requote branch conditions fire, and `confirm()` proceeds straight to
 * `repository.confirmDraft({draftId, expectedVersion, expectedHash, confirmationHash})` — which
 * transitions the OLD DELIVERY draft ROW to CONFIRMED status VERBATIM. `PrismaCommercialRepository
 * .confirmDraft()` only ever writes `status`/`confirmedAt`/`confirmationHash` — it never touches
 * `fulfillment`/`deliveryFee`/`deliveryAddress` (see that method, `prisma-commercial.repository.ts`).
 *
 * CONSEQUENCE: the persisted, CONFIRMED `SofiaOrderDraft` — the exact row
 * `OrderCreationService.createFromSofiaDraft()` reads `draft.fulfillment`/`draft.deliveryFee`/
 * `draft.deliveryAddress` from to materialize the real `OrderCheckout`/`OrderTicket` — still says
 * DELIVERY, with the OLD address and the OLD nonzero delivery fee. Meanwhile:
 *   (a) the customer-facing response text is 'TAKEAWAY_CONFIRMED' (`state.fulfillment === 'DELIVERY'
 *       ? 'DELIVERY_CONFIRMED' : 'TAKEAWAY_CONFIRMED'` reads the IN-MEMORY `state.fulfillment`,
 *       which correctly says TAKEAWAY) — the customer is TOLD "listo para recoger en el local", and
 *   (b) the conversation memory persisted to Postgres (`sofiaConversationMemory
 *       .currentOrderIntentJson`) ALSO says `fulfillment: 'TAKEAWAY'`, `deliveryFee: 0` — but
 *   (c) the ACTUAL commercial record that downstream order materialization/SecureCommand acts on
 *       (`sofia_order_drafts` row, status CONFIRMED) says DELIVERY with the OLD fee/address.
 *
 * This is a direct, real financial/operational mismatch between what the customer was told, what the
 * conversation state records, and what gets materialized/charged — a courier would be dispatched to
 * an address the customer just withdrew, and/or the customer is charged a delivery fee for an order
 * they explicitly said they would pick up themselves. It violates invariant #11 ("a confirmed
 * checkout's price must always correspond to destination/fulfillment evidence ACTUALLY CURRENT at
 * confirmation time") and #13 ("an edit to a conversation that is not itself address/fulfillment-
 * confirming evidence must never silently promote a stale commercial price into a fresh,
 * re-authorized one" — here inverted: an edit that VERY MUCH IS fulfillment-changing evidence fails
 * to invalidate the stale DELIVERY confirmation at all).
 *
 * Root cause, precisely: `quoteStillBound`'s `state.fulfillment !== 'DELIVERY'` short-circuit
 * conflates two different questions — "was this conversation ALREADY non-DELIVERY" (safe to skip
 * the destination-binding check) vs. "does the DRAFT ABOUT TO BE CONFIRMED still represent the
 * fulfillment type this turn actually requested" (never checked at all). A9-A20 hardened the
 * ADDRESS axis of "does the draft being confirmed still match current reality" exhaustively; this
 * file shows the FULFILLMENT axis of that exact same question was never covered.
 *
 * Real Postgres (isolated `a21_round5_test` database), real unmocked `CommercialCheckoutService` +
 * `CommercialIntentEngine` + `CommercialPolicyService` + `PrismaCommercialRepository` +
 * `DeliveryPricingService` + `DeliveryExternalDataService` (real audit persistence, real FK-backed
 * `SofiaOrderDraft`/`WhatsappConversation`/`Customer` rows) — only the routing/weather HTTP-provider
 * layer is doubled, matching every precedent Round 5 real-engine fixture (A11-A18). `orderCreation`
 * (SecureCommand `SOFIA_CREATE_ORDER` bridge) is a spy, not because it needs mocking for this bug —
 * the bug is fully proven from the persisted `SofiaOrderDraft` row alone — but to observe exactly
 * which stale `draftId` a real SecureCommand dispatch would be told to materialize.
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
  throw new Error('A21 red team requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
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
  return { conversationId, message, phone: '573009876543', displayName: 'Cliente A21', actor, location };
}

describe('A21 Round 5 blind red team — single-message "confirmo" + fulfillment switch (DELIVERY->TAKEAWAY) confirms the STALE DELIVERY draft verbatim', () => {
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
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A21' } }).catch(() => undefined);
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
    // Spy, not a functional mock: this bug is proven purely from the persisted SofiaOrderDraft row.
    // We just want to see exactly what a real SecureCommand(SOFIA_CREATE_ORDER) dispatch would be
    // told to materialize once that gate is owner-activated.
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
    'ATTACK: "Confirmo, mejor paso por el local" in ONE message (CONFIRM intent + TAKEAWAY fulfillment ' +
      'parsed independently from the same text) confirms the OLD DELIVERY draft VERBATIM — customer is ' +
      'told TAKEAWAY_CONFIRMED while the persisted, CONFIRMED, materializable commercial record still ' +
      'says DELIVERY with the original address and the original nonzero delivery fee',
    async () => {
      const conversationId = `a21-fulfillment-switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009876543', provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A21' } });

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

      // The in-memory/response layer correctly reflects TAKEAWAY (this is the "safe-looking" half of
      // the bug — the customer is told a story that matches their words)...
      expect(attackResult.state.fulfillment).toBe('TAKEAWAY');
      expect(attackResult.state.confirmationState).toBe('CONFIRMED');
      expect(attackResult.factEnvelope.responsePurpose).toBe('TAKEAWAY_CONFIRMED');
      expect(attackResult.nextAction).toBe('DRAFT_CONFIRMED');

      // ...but confirm() reused the SAME draftId from turn 1 without ever re-validating that a
      // DELIVERY draft still represents what THIS turn actually asked for once fulfillment flipped.
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: originalDraftId }),
      );

      // THE SMOKING GUN — reload the draft fresh from Postgres, independent of anything this
      // process() call chain claimed in memory. This is the EXACT row
      // OrderCreationService.createFromSofiaDraft() -> PrismaOrderCheckoutRepository
      // .createFromSofiaDraft() reads `draft.fulfillment`/`draft.deliveryFee`/`draft.deliveryAddress`
      // from to build the real OrderCheckout once SOFIA_CREATE_ORDER is owner-activated.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('CONFIRMED'); // really confirmed, not merely attempted
      // *** STILL DELIVERY, with the OLD address and the OLD nonzero fee — never TAKEAWAY, never 0 ***
      expect(draftAfterAttack.fulfillment).toBe('DELIVERY');
      expect(Number(draftAfterAttack.deliveryFee)).toBe(originalFee);
      expect(draftAfterAttack.deliveryAddress).toBe(originalAddress);
      expect(draftAfterAttack.deliveryQuoteAuditId).toBe(originalAuditId);
      expect(Number(draftAfterAttack.total)).toBeGreaterThan(25000); // 25000 item + a real nonzero delivery fee, not a takeaway 25000-only total

      // Cross-check against what a HONEST, non-attack TAKEAWAY confirmation actually persists, so the
      // mismatch above is not an artifact of this test's own assumptions about the schema.
      const honestConversationId = `a21-fulfillment-switch-honest-${Date.now()}`;
      await prisma.whatsappConversation.create({ data: { id: honestConversationId, phone: '573009876544', provider: 'whatsapp_business_api' } });
      const honestCustomer = await prisma.customer.create({ data: { displayName: 'Cliente A21' } });
      const { service: honestService } = buildService(honestCustomer.id);
      await honestService.process(cmd(honestConversationId, 'Quiero un combo 2x1, lo recojo yo y pago alla'));
      const honestReady = await honestService.process(cmd(honestConversationId, 'confirmo'));
      expect(honestReady.state.fulfillment).toBe('TAKEAWAY');
      const honestDraft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: honestReady.state.draftId! } });
      expect(honestDraft.fulfillment).toBe('TAKEAWAY'); // genuine takeaway confirmations DO persist TAKEAWAY
      expect(Number(honestDraft.deliveryFee)).toBe(0);
      expect(honestDraft.deliveryAddress).toBeNull();

      // The persisted conversation MEMORY (separate table from the draft) also says TAKEAWAY/fee=0 —
      // proving the divergence is specifically between "what confirm() actually committed to the
      // draft row" and "everything else in the system", not a blanket state-tracking failure.
      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { fulfillment: string; deliveryFee: number | null; confirmationState: string };
      expect(persistedState.fulfillment).toBe('TAKEAWAY');
      expect(persistedState.deliveryFee).toBe(0);
      expect(persistedState.confirmationState).toBe('CONFIRMED');

      console.log(
        `[A21 CRITICAL] conversationId=${conversationId} draftId=${originalDraftId} ` +
          `conversationMemory.fulfillment=${persistedState.fulfillment} (told to customer) vs ` +
          `CONFIRMED sofia_order_drafts.fulfillment=${draftAfterAttack.fulfillment} fee=${draftAfterAttack.deliveryFee} ` +
          `address="${draftAfterAttack.deliveryAddress}" (what materializes/charges) — MISMATCH proven.`,
      );
    },
  );
});
