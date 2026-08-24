/**
 * SOFIA Round 5 / A13 — BLIND independent red team finding (real Postgres, real unmocked
 * `CommercialCheckoutService`, `DeliveryPricingService`, `DeliveryExternalDataService`,
 * `PrismaCommercialRepository`, `applyDestinationEdit`; only the routing/weather HTTP providers
 * are doubled, exactly like the precedent A11/A12 real-engine fixtures).
 *
 * SCOPE: this file was written with zero prior knowledge of A9-A12's design docs beyond reading the
 * shipped code fresh from `feat/sofia-remediation-address-round5-12-integration-verifier`. A9-A12
 * closed every scenario where a REVISION BUMP is the correct/expected signal (address-text change,
 * concurrent hybrid writes, process restart, quote binding across a textual address change, etc —
 * see `round5-a12-cross-cutting-verification.spec.ts` and
 * `commercial-checkout.destination-state.spec.ts`'s "QUOTE BINDING" describe block). Every one of
 * those existing tests changes the quote binding's ADDRESS TEXT (which correctly bumps
 * `destinationSnapshot.revision` and is caught by `isQuoteBoundToCurrentDestination`).
 *
 * THE GAP THIS FILE PROVES: `applyDestinationEdit`'s RULE 3/4 (`destination-revision.ts`) are
 * — correctly, by design — meant to let a coordinate-only refinement of the SAME address update
 * `latitude`/`longitude`/`coordinateTrust` WITHOUT bumping `revision` (e.g. "same address, more
 * precise GPS pin"). But `confirm()`'s quote-binding guard
 * (`isQuoteBoundToCurrentDestination(state.deliveryQuoteDestinationBinding, state.destinationSnapshot)`,
 * `commercial-checkout.service.ts` line ~341-344) is keyed ONLY on `revision` +
 * `spatialFingerprint` — both of which are, by RULE 3/4's own definition, UNCHANGED by a
 * coordinate-only edit. So: if a conversation reaches READY_TO_CONFIRM with a cheap/AUTO_PRICED
 * quote computed from a NEAR (in-coverage) coordinate pair, and a LATER turn supplies a fresh,
 * TRUSTED, materially-DIFFERENT coordinate pair for the address text (no new address text, e.g. a
 * bare WhatsApp live-location share with no caption — completely realistic; live-location shares
 * carry no text), that new evidence is accepted into `destinationSnapshot` (RULE 4: "new trusted
 * evidence replaces old evidence for the ACTIVE revision") but the STALE quote/draft from the
 * earlier, now-superseded coordinates remains "quoteStillBound === true" and can be confirmed
 * as-is on the next plain "confirmo" — with NO fresh pricing call at all. If a fresh quote would
 * have come back `OUT_OF_COVERAGE` (`canCheckout: false`) for the new coordinates, the customer's
 * order is nonetheless CONFIRMED (persisted, `SofiaOrderDraft.status = CONFIRMED`) carrying the
 * OLD cheap/in-coverage fee — a courier-dispatch and financial mismatch: the system's own current,
 * TRUSTED evidence says the destination is out of coverage, yet checkout completed anyway.
 *
 * This violates invariant #5 (STALE_QUOTE_REUSE — "a delivery price quote computed for one
 * destination must never be usable to complete checkout after the destination has changed... the
 * system must require a fresh quote") even though, textually, "the destination" (address string)
 * never changed — what changed is the EVIDENCE about where that address actually is, and pricing
 * authority never re-validated it before confirming.
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
import type { CommercialConversationState, CommercialMessageCommand } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A13 red team requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

// Same fixture constants as the precedent A11/A12 real-engine specs, for direct comparability.
const origin = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };
const NEAR_LATITUDE = 3.255; // ~2km, in-coverage / AUTO_PRICED
const NEAR_LONGITUDE = -76.545;
const FAR_LATITUDE = 3.62; // ~42km, correctly OUT_OF_COVERAGE
const FAR_LONGITUDE = -76.15;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-20T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const isFar = Math.abs(request.destinationLatitude - FAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - FAR_LONGITUDE) < 1e-6;
    const isNear = Math.abs(request.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - NEAR_LONGITUDE) < 1e-6;
    const distanceKm = isFar ? 42 : isNear ? 2 : 77;
    const result: RouteResult = { provider: 'mock-route', distanceKm, durationMinutes: isFar ? 60 : 15, routeConfidence: 'HIGH', warnings: [] };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
}

// Only the routing/weather HTTP-provider layer is doubled (per the task's mocking rule). Everything
// else — including the `DeliveryPricingAudit` sink — runs against the real isolated Postgres
// database (see `buildService()` below).
const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

function cmd(conversationId: string, message: string, location?: { latitude: number; longitude: number }): CommercialMessageCommand {
  return { conversationId, message, phone: '573001234567', displayName: 'Cliente A13', actor, location };
}

describe('A13 Round 5 blind red team — coordinate-only turn silently bypasses SOFIA quote-binding at confirm()', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a13-stale-quote-' } } }).catch(() => undefined);
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a13-stale-quote-' } } }).catch(() => undefined);
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a13-stale-quote-' } } }).catch(() => undefined);
    // Isolated, dedicated test database (`a13_round5_test`) — safe to clear every audit row this
    // file's own run created (nothing else writes to this database).
    await prisma.deliveryPricingAudit.deleteMany({}).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A13' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  function buildService(customerId: string) {
    const repository = new PrismaCommercialRepository(prisma as never);
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true, origin, cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(), routingProvider: buildRoutingProvider(),
    });
    // REAL pricing authority: the exact engine that decides LOCAL_FREE / AUTO_PRICED /
    // OUT_OF_COVERAGE for legacy POS and SOFIA alike. Not a hand-rolled quote mock. Uses the real
    // Postgres connection (not a stub) for the audit sink too, since `SofiaOrderDraft
    // .deliveryQuoteAuditId` carries a REAL foreign key to `delivery_pricing_audits.id` — a fake/
    // stub audit id would fail that constraint on `saveDraft`, so this test's audit trail is
    // fully real, not merely a JS object double.
    const pricingService = new DeliveryPricingService(externalDataService, prisma as never);
    const quoteAdapter = new AuthoritativeDeliveryQuoteAdapter(pricingService);
    const product = {
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const responses = new CommercialResponseComposer({ compose: jest.fn(async () => null) }, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
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
    return { service, pricingService };
  }

  it(
    'draft confirmed AUTO_PRICED (NEAR) is confirmed as-is even after a later bare live-location share ' +
      'proves the SAME address is actually OUT_OF_COVERAGE (42km) — never requoted, never blocked',
    async () => {
      const conversationId = `a13-stale-quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Real FK-backed WhatsappConversation row (sofia_order_drafts.conversation_id has a real FK
      // to whatsapp_conversations.id) — a genuine conversation, not a bypassed constraint.
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001234567', provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A13' } });

      const { service, pricingService } = buildService(customer.id);

      // Turn 1: item + delivery + COD payment + address text, WITH a real NEAR (in-coverage) GPS
      // share in the same turn — reaches READY_TO_CONFIRM through the REAL pricing engine
      // (AUTO_PRICED, real positive fee, real audit id), exactly like the precedent compound-message
      // tests in `commercial-checkout.destination-state.spec.ts`.
      const ready = await service.process(
        cmd(conversationId, 'Mándame un combo 2x1 a la Avenida 9 #50-30 y pago cuando llegue', { latitude: NEAR_LATITUDE, longitude: NEAR_LONGITUDE }),
      );
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('DELIVERY');
      expect(ready.state.deliveryFee).toBeGreaterThan(0); // real AUTO_PRICED fee, never LOCAL_FREE/0
      const originalFee = ready.state.deliveryFee;
      const originalAuditId = ready.state.deliveryQuoteAuditId;
      const originalRevision = ready.state.destinationSnapshot?.revision;
      const originalFingerprint = ready.state.destinationSnapshot?.spatialFingerprint;
      const originalDraftId = ready.state.draftId;
      const originalDraftVersion = ready.state.draftVersion;
      expect(originalDraftId).toBeTruthy();

      // Turn 2: a BARE live-location share — no text caption at all (realistic: WhatsApp
      // "share live location" messages normally carry no caption text). It supplies a FAR (42km,
      // genuinely OUT_OF_COVERAGE) coordinate pair for the exact same, unchanged address text.
      const gpsOnly = await service.process(cmd(conversationId, '', { latitude: FAR_LATITUDE, longitude: FAR_LONGITUDE }));

      // The destination-state authority correctly ingests the new evidence as TRUSTED...
      expect(gpsOnly.state.destinationSnapshot?.latitude).toBeCloseTo(FAR_LATITUDE, 5);
      expect(gpsOnly.state.destinationSnapshot?.longitude).toBeCloseTo(FAR_LONGITUDE, 5);
      expect(gpsOnly.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
      // ...but — BY THE STATE MACHINE'S OWN DESIGN (RULE 3/4: a coordinate-only edit with no new
      // address text never bumps the spatial revision) — the revision/fingerprint the quote is
      // bound to is UNCHANGED:
      expect(gpsOnly.state.destinationSnapshot?.revision).toBe(originalRevision);
      expect(gpsOnly.state.destinationSnapshot?.spatialFingerprint).toBe(originalFingerprint);
      // The PENDING draft/quote from turn 1 was never invalidated by this turn:
      expect(gpsOnly.state.confirmationState).toBe('PENDING');
      expect(gpsOnly.state.draftId).toBe(originalDraftId);
      expect(gpsOnly.state.deliveryQuoteAuditId).toBe(originalAuditId);

      // Ground truth: what does the REAL pricing authority say for this exact (still-unchanged)
      // address text, now correctly evidenced by TRUSTED coordinates 42km away?
      const freshQuote = await pricingService.estimate({ addressText: 'Avenida 9 #50-30', latitude: FAR_LATITUDE, longitude: FAR_LONGITUDE, orderSubtotal: 25000 });
      expect(freshQuote.pricingStatus).toBe('OUT_OF_COVERAGE');
      expect(freshQuote.canCheckout).toBe(false);
      expect(freshQuote.finalFee).toBeNull();

      // Turn 3: a plain "confirmo", no location this time — `lastQuestionPurpose` is still
      // 'CONFIRM_ORDER' from turn 1 (never touched by turn 2's handoff/no-op path).
      const confirmed = await service.process(cmd(conversationId, 'confirmo'));

      // THE FINDING: confirm() succeeds using the STALE (NEAR/AUTO_PRICED) quote from turn 1 —
      // never requoted, never blocked — even though the CURRENT `destinationSnapshot` (persisted
      // between turns 2 and 3, independent of any in-memory state) is TRUSTED-bound to a point a
      // fresh call to the SAME real pricing engine proves is OUT_OF_COVERAGE.
      expect(confirmed.nextAction).toBe('DRAFT_CONFIRMED');
      expect(confirmed.state.confirmationState).toBe('CONFIRMED');
      expect(confirmed.state.deliveryQuoteAuditId).toBe(originalAuditId);
      expect(confirmed.state.deliveryFee).toBe(originalFee);
      // Yet the "current" destination this confirmed order actually carries is 42km away:
      expect(confirmed.state.destinationSnapshot?.latitude).toBeCloseTo(FAR_LATITUDE, 5);
      expect(confirmed.state.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');

      // Persisted proof — not merely an in-memory artifact of this one process() chain: reload both
      // rows fresh from Postgres.
      const draftRow = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId! } });
      expect(draftRow.status).toBe('CONFIRMED');
      expect(draftRow.version).toBe(originalDraftVersion);
      expect(Number(draftRow.deliveryFee)).toBe(originalFee);
      expect(draftRow.deliveryAddress).toBe('Avenida 9 #50-30');

      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as {
        destinationSnapshot: { latitude: number | null; longitude: number | null; coordinateTrust: string; revision: number } | null;
        confirmationState: string;
        deliveryQuoteAuditId: string | null;
      };
      expect(persistedState.confirmationState).toBe('CONFIRMED');
      expect(persistedState.deliveryQuoteAuditId).toBe(originalAuditId);
      expect(persistedState.destinationSnapshot?.latitude).toBeCloseTo(FAR_LATITUDE, 5);
      expect(persistedState.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');

      // Summary of the confirmed mismatch: a CONFIRMED order, dispatch-ready, whose OWN persisted
      // TRUSTED coordinates are 42km from the store (OUT_OF_COVERAGE per the real engine), yet was
      // never blocked and was priced/confirmed at the original in-coverage fee.
      // eslint-disable-next-line no-console
      console.log(
        `[A13 FINDING] conversationId=${conversationId} confirmedFee=${confirmed.state.deliveryFee} ` +
          `freshQuoteStatus=${freshQuote.pricingStatus} freshQuoteCanCheckout=${freshQuote.canCheckout} ` +
          `confirmedDestinationLatLng=(${confirmed.state.destinationSnapshot?.latitude},${confirmed.state.destinationSnapshot?.longitude})`,
      );
    },
  );
});
