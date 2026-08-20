/**
 * A6 RED TEAM — independent finding, NOT part of A5's own test file.
 *
 * A5's `spatial-authority-parity.spec.ts` "SOFIA path" tests call
 * `AuthoritativeDeliveryQuoteAdapter.quote({ addressText, latitude, longitude, ... })` DIRECTLY,
 * hand-supplying latitude/longitude. That proves the adapter+engine are correct in isolation, but
 * it does NOT prove the real production caller (`CommercialCheckoutService.prepareDraft`,
 * commercial-checkout.service.ts:209) ever actually forwards a real point into that call.
 *
 * `CommercialMessageCommand.location` (commercial.types.ts:61) and
 * `CommercialConversationState.location` (commercial.types.ts:30) are real, documented fields
 * for an already-resolved trusted point (e.g. a WhatsApp live-location share) that IS captured
 * into conversation state (commercial-checkout.service.ts:70: `location: command.location ??
 * previous.location`) — but grepping the entire file shows `state.location` is NEVER read again
 * anywhere else. The delivery quote call at commercial-checkout.service.ts:209 is:
 *
 *   this.deliveryQuotes.quote({ addressText: state.address!, orderSubtotal: subtotal, actor: command.actor })
 *
 * — no `latitude`/`longitude`/`location` field at all, despite `DeliveryQuoteService.quote()`
 * (sofia-domain-contracts.ts) explicitly accepting `latitude?: number; longitude?: number`.
 *
 * CONSEQUENCE: on the real SOFIA/WhatsApp production path, `hasRealPoint` inside
 * `DeliveryPricingEngine.quote()` can NEVER be true, no matter what location the customer shared.
 * A5's round-4 TRUSTED_SPATIAL_DATA fix is real and correct in the engine, but it is unreachable
 * from the one call site that is supposed to invoke it in production — meaning the exact bug this
 * round claims to close (a real point 42km away + a textual "alborada" alias still gets
 * LOCAL_FREE/fee=0/coverageAllowed=true/canCheckout=true) remains fully exploitable via SOFIA
 * today. This test proves it two ways:
 *
 *   1. A spy DELIVERY_QUOTE_SERVICE proves the real args sent by the real service never carry
 *      the location the customer shared (the wiring gap itself).
 *   2. The REAL AuthoritativeDeliveryQuoteAdapter + REAL DeliveryPricingEngine + REAL
 *      DeliveryPricingService + DeliveryExternalDataService (only network geocode/route/weather
 *      providers doubled) wired in as DELIVERY_QUOTE_SERVICE proves the end-to-end customer-facing
 *      outcome: LOCAL_FREE / fee=0 / canCheckout=true for a customer whose shared live location is
 *      42km from the store, because that location never reaches the pricing pipeline at all.
 */

import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';
import type { CommercialConversationState } from './commercial.types';
import { AuthoritativeDeliveryQuoteAdapter } from '../../../delivery/delivery-quote.adapter';
import { DeliveryPricingService } from '../../../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../../../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../../../delivery/providers/in-memory-external-cache';
import type { RouteResult, WeatherResult } from '../../../delivery/providers/provider-types';
import type { RoutingProvider } from '../../../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../../../delivery/providers/weather-provider.interface';

const engine = new CommercialIntentEngine();

const origin = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };
// A live-location share ~42km from the store — well outside any configured coverage
// (maxAutoDistanceKm = 8).
const FAR_LATITUDE = 3.62;
const FAR_LONGITUDE = -76.15;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-20T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  // Real route: 42km / 60 minutes from the store to FAR_LATITUDE/FAR_LONGITUDE.
  const result: RouteResult = {
    provider: 'mock-route', distanceKm: 42, durationMinutes: 60, routeConfidence: 'HIGH', warnings: [],
  };
  return { providerName: 'mock-route', getRoute: jest.fn().mockResolvedValue(result) };
}

function emptyState(conversationId: string): CommercialConversationState {
  return {
    schemaVersion: 4, conversationId, customerId: null, intent: 'UNKNOWN', items: [], fulfillment: null, address: null, addressConfirmed: false, location: null,
    paymentPreference: 'UNKNOWN', paymentReadiness: 'PAYMENT_UNRESOLVED', subtotal: null, deliveryFee: null, total: null, deliveryQuoteAuditId: null,
    deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [], draftId: null, draftVersion: null,
    draftHash: null, confirmationState: 'NONE',
    missingFields: [], ambiguities: [], confidence: 'LOW', handoffState: 'SOFIA_ACTIVE', consentState: 'SERVICE',
    domainErrors: [], lastQuestionPurpose: null, lastResolvedIntent: null, expiresAt: null,
  };
}

function buildService(deliveryQuoteService: { quote: jest.Mock }, seedState: CommercialConversationState | null = null) {
  let state: CommercialConversationState | null = seedState;
  const repository = {
    loadState: jest.fn(async () => state),
    saveState: jest.fn(async (next: CommercialConversationState) => { state = structuredClone(next); }),
    saveDraft: jest.fn(async (input: Record<string, unknown> & { version?: number }) => ({
      id: 'draft-1', version: (input.version as number) ?? 1, draftHash: 'hash', expiresAt: new Date(Date.now() + 60_000),
    })),
    confirmDraft: jest.fn(async () => ({ id: 'draft-1', version: 1, status: 'CONFIRMED' })),
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
  const service = new CommercialCheckoutService(
    engine, new CommercialPolicyService(), new CommercialMetricsService(), responses, repository as never,
    { listActive: jest.fn(async () => [product]), getActiveById: jest.fn(async () => product), findActive: jest.fn() } as never,
    { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
    { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
    { resolve: jest.fn(async () => ({ customerId: 'c1', displayName: null, phoneMasked: '***', created: false })) } as never,
    deliveryQuoteService as never,
    { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
    orderCreation as never,
  );
  return { service, repository };
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A6 RED TEAM: SOFIA commercial-checkout drops trusted live-location before delivery pricing', () => {
  it('FINDING 1 (wiring gap): a WhatsApp live-location share is captured into conversation state but never forwarded to DeliveryQuoteService.quote()', async () => {
    const quote = jest.fn(async (_input: { addressText?: string; latitude?: number; longitude?: number; orderSubtotal: number; actor: unknown }) => ({
      auditId: 'q1', status: 'AUTO_PRICED', finalFee: 5000, currency: 'COP' as const, distanceKm: 4,
      estimatedMinutes: 20, reasonCode: 'AUTO_PRICED', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: true,
    }));
    const { service } = buildService({ quote });

    const result = await service.process({
      conversationId: 'conv-redteam-1',
      phone: '573001112233',
      message: 'Mándame un combo 2x1 a la cra 5 # 10-20 barrio alborada y pago cuando llegue',
      actor,
      // Real, already-resolved trusted point 42km from the store — e.g. a WhatsApp live-location
      // share. This is the exact shape CommercialMessageCommand.location documents.
      location: { latitude: FAR_LATITUDE, longitude: FAR_LONGITUDE },
    });

    // The location WAS captured into conversation state...
    expect(result.state.location).toEqual({ latitude: FAR_LATITUDE, longitude: FAR_LONGITUDE });
    expect(result.state.fulfillment).toBe('DELIVERY');

    // ...but the actual call to the delivery pricing authority never carries it.
    expect(quote).toHaveBeenCalledTimes(1);
    const callArgs = quote.mock.calls[0]![0];
    expect(callArgs.latitude).toBeUndefined();
    expect(callArgs.longitude).toBeUndefined();
    // This is the vulnerability: DeliveryQuoteService.quote() explicitly supports latitude/longitude
    // (sofia-domain-contracts.ts DeliveryQuoteService), the customer supplied a real, trusted,
    // already-resolved point, and it was silently discarded before reaching pricing.
  });

  it('FINDING 1 IMPACT (end-to-end, real engine): a customer 42km away with "alborada" in the address text still gets LOCAL_FREE / fee=0 / canCheckout=true through the REAL commercial-checkout + REAL pricing engine because the real point never arrives', async () => {
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true,
      origin,
      cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(),
      routingProvider: buildRoutingProvider(),
    });
    // Minimal audit-write double (no real DB in this unit test) — required because
    // CommercialCheckoutService.prepareDraft hard-fails when `!quote.auditId` (line 210), exactly
    // as it does in production.
    const auditPrisma = { deliveryPricingAudit: { create: jest.fn(async () => ({ id: 'audit-redteam-1' })) } };
    const pricingService = new DeliveryPricingService(externalDataService, auditPrisma as never);
    const realSofiaAdapter = new AuthoritativeDeliveryQuoteAdapter(pricingService);
    const quoteSpy = jest.fn((input: Parameters<AuthoritativeDeliveryQuoteAdapter['quote']>[0]) => realSofiaAdapter.quote(input));

    // Seed a conversation where the address was already confirmed in an earlier turn as a
    // structurally-complete zone-only reference (genuine descriptive content, no street
    // designator, no digit — passes `isZoneOnlyReferenceStructurallyComplete` per A1/A2's own
    // positive-vocabulary rules: "barrio" + "alborada" are zone-anchor tokens, "casa"/"esquinera"/
    // "azul" are recognized content-vocabulary tokens). This is a realistic prior-turn state, not
    // a fabricated shortcut — `state.address`/`addressConfirmed` persist across turns exactly this
    // way in production (see commercial-checkout.service.ts:110-112).
    const seedState: CommercialConversationState = {
      ...emptyState('conv-redteam-2'),
      address: 'barrio alborada casa esquinera azul',
      addressConfirmed: true,
    };
    const { service } = buildService({ quote: quoteSpy } as never, seedState);

    // Same turn: the customer shares a live WhatsApp location 42km from the store and asks for
    // delivery, paying on arrival. No street address is retyped — the previously-confirmed
    // zone-only reference is reused, exactly as SOFIA is designed to do.
    const result = await service.process({
      conversationId: 'conv-redteam-2',
      phone: '573001112244',
      message: 'Mándeme un combo 2x1 de domicilio y pago cuando llegue',
      actor,
      location: { latitude: FAR_LATITUDE, longitude: FAR_LONGITUDE },
    });

    // Prove the real routing provider (42km) was never even consulted for this order, because the
    // real point never made it past the SOFIA call boundary.
    const routingProviderMock = (externalDataService as unknown as { routingProvider: RoutingProvider }).routingProvider;
    expect((routingProviderMock.getRoute as jest.Mock)).not.toHaveBeenCalled();

    // The customer-facing, checkout-eligible outcome: free delivery and a confirmable draft,
    // despite the customer's own shared live location being 42km from the store — the exact
    // "REMAINING CRITICAL" scenario this round was chartered to close, still fully open on SOFIA.
    expect(result.nextAction).toBe('READY_TO_CONFIRM');
    expect(result.state.deliveryFee).toBe(0);
    expect(result.state.total).toBe(25000);
    const quoteResult = await quoteSpy.mock.results[0]!.value;
    expect(quoteResult.status).toBe('LOCAL_FREE');
    expect(quoteResult.canCheckout).toBe(true);
  });
});
