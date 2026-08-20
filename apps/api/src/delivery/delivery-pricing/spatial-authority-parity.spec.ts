/**
 * SOFIA Address Remediation — Round 4 / A5 (TRUSTED_SPATIAL_DATA > TEXTUAL_ZONE_ALIAS).
 *
 * THE BUG THIS FILE PROVES FIXED
 * -------------------------------
 * A real, already-resolved trusted geocoded point could be genuinely far outside the intended
 * local-free zone (e.g. 42km away) while a textual zone alias ("alborada") in another field still
 * caused `DeliveryPricingEngine.quote()`'s LOCAL_FREE branch to unconditionally set
 * `pricingStatus: 'LOCAL_FREE'`, `finalFee: 0`, `coverageAllowed: true`, `canCheckout: true` — it
 * never consulted the already-computed `context.route.distanceKm` / `durationMinutes` for that
 * branch. Discovery (grepped config/constants/admin data/Prisma models) found NO real
 * geofence/polygon/radius authority for Condados/Alborada anywhere in this codebase — the only
 * hit, `modules/orders/delivery-zones.ts`, is an explicitly-inactive legacy file, so CASE 2C of
 * the owner-mandated decision table (spatially-proven zone membership) is correctly unreachable
 * today. The fix in `delivery-pricing.engine.ts` therefore makes a real point (once known) flow
 * through the exact same real distance/coverage/pricing logic as any other destination — a
 * textual alias never grants LOCAL_FREE/coverageAllowed/fee=0 once real coordinates exist.
 *
 * WHY THIS FILE EXISTS (SEPARATE FROM delivery-pricing.spec.ts)
 * ----------------------------------------------------------------
 * `delivery-pricing.spec.ts` proves the engine's decision logic in isolation via hand-built
 * `DeliveryContextResult` fixtures. This file proves the SAME 15-case decision table holds for
 * the two REAL production entrypoints, driven through the REAL, unmocked
 * `DeliveryPricingService.estimate()` -> `DeliveryExternalDataService.resolveDeliveryContext()` ->
 * `DeliveryPricingEngine.quote()` pipeline (only the network-facing geocoding/weather/routing
 * *providers* are swapped for controllable doubles, exactly as `delivery-external-data.service.spec.ts`
 * already does — CLAUDE.md section 18 permits provider mocks in tests):
 *
 *   - SOFIA path: `AuthoritativeDeliveryQuoteAdapter.quote()` — the literal class
 *     `DELIVERY_QUOTE_SERVICE` resolves to in production, called with the same shape
 *     `commercial-checkout.service.ts` uses (addressText/latitude/longitude/orderSubtotal/actor).
 *   - Legacy POS path: `DeliveryPricingService.estimate()` called with the EXACT request shape
 *     `orders.service.ts::resolveDeliverySnapshot` builds (addressText AND reference both set to
 *     the deliveryReference string, latitude/longitude, `location: {..., confidence}`) — see that
 *     method for the shape this mirrors 1:1.
 *
 * Both entrypoints share one `DeliveryExternalDataService` test double per case, so a pass here
 * proves REAL single-authority parity, not merely "both call the same function".
 */

import { DeliveryExternalDataService } from '../providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../providers/in-memory-external-cache';
import { DeliveryProviderError } from '../providers/provider-errors';
import type { RouteResult, WeatherResult } from '../providers/provider-types';
import type { RoutingProvider } from '../providers/routing-provider.interface';
import type { WeatherProvider } from '../providers/weather-provider.interface';
import { AuthoritativeDeliveryQuoteAdapter } from '../delivery-quote.adapter';
import { DeliveryPricingService } from './delivery-pricing.service';
import type { DeliveryPricingResult } from './delivery-pricing.types';

const origin = {
  latitude: 3.2601,
  longitude: -76.5405,
  label: '2X1 Burger Co',
  address: 'Local principal',
};

// Fixed destination coordinates for every case — the exact numeric haversine value is irrelevant
// because the mocked routing provider (below) fully controls `distanceKm`/`durationMinutes`, which
// is the ONLY spatial signal the engine's real-distance branches consult.
const destinationLatitude = 3.258;
const destinationLongitude = -76.542;

function weatherResult(): WeatherResult {
  return {
    provider: 'mock-weather',
    isRaining: false,
    precipitationMm: 0,
    rainIntensity: 'NONE',
    confidence: 'HIGH',
    fetchedAt: new Date('2026-08-20T12:00:00.000Z'),
    warnings: [],
  };
}

function buildWeatherProvider(): WeatherProvider {
  return {
    providerName: 'mock-weather',
    getCurrentWeather: jest.fn().mockResolvedValue(weatherResult()),
  };
}

function buildRoutingProvider(route: { distanceKm: number; durationMinutes: number } | 'UNAVAILABLE'): RoutingProvider {
  if (route === 'UNAVAILABLE') {
    return {
      providerName: 'mock-route',
      getRoute: jest.fn().mockRejectedValue(new DeliveryProviderError('routing down', 'ROUTING_UNAVAILABLE', 'mock-route')),
    };
  }
  const result: RouteResult = {
    provider: 'mock-route',
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    routeConfidence: 'HIGH',
    warnings: [],
  };
  return {
    providerName: 'mock-route',
    getRoute: jest.fn().mockResolvedValue(result),
  };
}

function buildServices(route: { distanceKm: number; durationMinutes: number } | 'UNAVAILABLE') {
  const externalDataService = DeliveryExternalDataService.createForTesting({
    providersEnabled: true,
    origin,
    cache: new InMemoryExternalCache(),
    weatherProvider: buildWeatherProvider(),
    routingProvider: buildRoutingProvider(route),
  });
  const pricingService = new DeliveryPricingService(externalDataService);
  const sofiaAdapter = new AuthoritativeDeliveryQuoteAdapter(pricingService);
  return { pricingService, sofiaAdapter };
}

type CaseInput = {
  addressText?: string;
  route: { distanceKm: number; durationMinutes: number } | 'UNAVAILABLE';
  withCoordinates: boolean;
};

async function runSofiaPath(sofiaAdapter: AuthoritativeDeliveryQuoteAdapter, input: CaseInput) {
  return sofiaAdapter.quote({
    addressText: input.addressText,
    latitude: input.withCoordinates ? destinationLatitude : undefined,
    longitude: input.withCoordinates ? destinationLongitude : undefined,
    orderSubtotal: 20000,
    actor: { actorId: 'test-actor', roles: ['SOFIA'], source: 'SOFIA_SANDBOX' },
  });
}

async function runLegacyPosPath(pricingService: DeliveryPricingService, input: CaseInput): Promise<DeliveryPricingResult> {
  // Mirrors orders.service.ts::resolveDeliverySnapshot exactly: addressText AND reference both
  // carry the raw deliveryReference string; latitude/longitude + location{...} carry a live
  // pinned/geocoded point when present (WhatsApp live-location / map pick), confidence defaults
  // 'HIGH' exactly as that method does.
  const latitude = input.withCoordinates ? destinationLatitude : null;
  const longitude = input.withCoordinates ? destinationLongitude : null;
  return pricingService.estimate({
    addressText: input.addressText ?? null,
    reference: input.addressText ?? null,
    latitude,
    longitude,
    location:
      latitude != null && longitude != null
        ? { provider: 'whatsapp_live_location', placeId: null, formattedAddress: input.addressText ?? null, latitude, longitude, confidence: 'HIGH' }
        : null,
    orderSubtotal: 20000,
  });
}

describe('SOFIA vs legacy POS spatial-authority parity (A5 — TRUSTED_SPATIAL_DATA > TEXTUAL_ZONE_ALIAS)', () => {
  it('CASE 1: bare zone-alias text with real coordinates never becomes LOCAL_FREE without a proven geofence — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 1.0, durationMinutes: 8 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 1.0, durationMinutes: 8 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).not.toBe('LOCAL_FREE');
    expect(pos.pricingStatus).not.toBe('LOCAL_FREE');
    expect(sofia.status).toBe('AUTO_PRICED');
    expect(pos.pricingStatus).toBe('AUTO_PRICED');
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
    expect(sofia.finalFee).toBe(pos.finalFee);
    expect(pos.checkoutAuthorization.zoneMatched).toBe(true);
    expect(pos.checkoutAuthorization.coverageAllowed).toBe(true);
  });

  it('CASE 2: text="alborada", coordinates 2km away, not free-zone geography -> must NOT get free delivery — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 2, durationMinutes: 10 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 2, durationMinutes: 10 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('AUTO_PRICED');
    expect(pos.pricingStatus).toBe('AUTO_PRICED');
    expect(sofia.finalFee).toBeGreaterThan(0);
    expect(pos.finalFee).toBeGreaterThan(0);
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
  });

  it('CASE 3: text="alborada", coordinates 7km away (inside maxAutoDistance) but not free zone -> normal pricing, not fee=0 — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 7, durationMinutes: 20 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 7, durationMinutes: 20 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('AUTO_PRICED');
    expect(pos.pricingStatus).toBe('AUTO_PRICED');
    expect(sofia.finalFee).not.toBe(0);
    expect(pos.finalFee).not.toBe(0);
    expect(sofia.finalFee).toBeGreaterThan(0);
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
  });

  it('CASE 4: text="alborada", coordinates 9km away, maxAutoDistance=8 -> canCheckout=false — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 9, durationMinutes: 20 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 9, durationMinutes: 20 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
    expect(sofia.finalFee).toBeNull();
    expect(pos.finalFee).toBeNull();
    expect(pos.checkoutAuthorization.zoneMatched).toBe(true);
    expect(pos.checkoutAuthorization.coverageAllowed).toBe(false);
  });

  it('CASE 5: text="alborada", route distance=42km -> canCheckout=false — both paths (the exact reported bug)', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 42, durationMinutes: 70 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 42, durationMinutes: 70 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
    expect(sofia.finalFee).toBeNull();
    expect(pos.finalFee).toBeNull();
  });

  it('CASE 6: text="alborada", route duration exceeds configured maximum -> canCheckout=false — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 5, durationMinutes: 50 });
    const input: CaseInput = { addressText: 'alborada', route: { distanceKm: 5, durationMinutes: 50 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
  });

  it('CASE 7 (regression): valid free-zone textual address with NO coordinates preserves legitimate LOCAL_FREE behavior — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 2, durationMinutes: 10 });
    const input: CaseInput = { addressText: 'alborada casa azul frente al parque', route: 'UNAVAILABLE', withCoordinates: false };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('LOCAL_FREE');
    expect(pos.pricingStatus).toBe('LOCAL_FREE');
    expect(sofia.finalFee).toBe(0);
    expect(pos.finalFee).toBe(0);
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
    expect(pos.checkoutAuthorization.addressComplete).toBe(true);
  });

  it('CASE 8 (regression): zone-only alias with NO coordinates and no complement -> addressComplete=false — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 2, durationMinutes: 10 });
    const input: CaseInput = { addressText: 'alborada', route: 'UNAVAILABLE', withCoordinates: false };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('LOCAL_FREE');
    expect(pos.pricingStatus).toBe('LOCAL_FREE');
    expect(pos.checkoutAuthorization.addressComplete).toBe(false);
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
  });

  it('CASE 9: trusted coordinates + a "complete-looking" conflicting zone alias -> spatial truth wins, not text — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 10, durationMinutes: 25 });
    // This exact text ("condados de la alborada casa azul") would have been addressComplete=true
    // under the pre-A5 zone-only-text rule. With a real point 10km away (outside maxAutoDistanceKm),
    // spatial truth must still block checkout.
    const input: CaseInput = {
      addressText: 'condados de la alborada casa azul',
      route: { distanceKm: 10, durationMinutes: 25 },
      withCoordinates: true,
    };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
  });

  it('CASE 10: trusted coordinates + Unicode/zero-width-manipulated alias -> spatial truth wins, not text — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 42, durationMinutes: 70 });
    // Zero-width space injected mid-word plus a fullwidth-digit house number — regardless of
    // whether this text would or would not match the zone vocabulary, a real point 42km away must
    // never become checkout-eligible from text alone.
    const input: CaseInput = {
      addressText: 'a​lborada casa ４５',
      route: { distanceKm: 42, durationMinutes: 70 },
      withCoordinates: true,
    };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).not.toBe('LOCAL_FREE');
    expect(pos.pricingStatus).not.toBe('LOCAL_FREE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
    expect(sofia.finalFee).toBeNull();
    expect(pos.finalFee).toBeNull();
  });

  it('CASE 11: trusted coordinates inside normal paid coverage (no zone alias at all) -> correct non-zero fee — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 4, durationMinutes: 18 });
    const input: CaseInput = { addressText: 'Carrera 10 # 5-20', route: { distanceKm: 4, durationMinutes: 18 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('AUTO_PRICED');
    expect(pos.pricingStatus).toBe('AUTO_PRICED');
    expect(sofia.finalFee).toBeGreaterThan(0);
    expect(pos.finalFee).toBeGreaterThan(0);
    expect(sofia.finalFee).toBe(pos.finalFee);
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
  });

  it('CASE 12: trusted coordinates outside all coverage (no zone alias) -> no checkout — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 20, durationMinutes: 40 });
    const input: CaseInput = { addressText: 'Vereda El Rosario km 20', route: { distanceKm: 20, durationMinutes: 40 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
  });

  it('CASE 13: coordinates at exact configured distance boundary (8km) -> still auto-priced (inclusive boundary) — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 8, durationMinutes: 30 });
    const input: CaseInput = { addressText: 'Carrera 10 # 5-20', route: { distanceKm: 8, durationMinutes: 30 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('AUTO_PRICED');
    expect(pos.pricingStatus).toBe('AUTO_PRICED');
    expect(sofia.canCheckout).toBe(true);
    expect(pos.canCheckout).toBe(true);
    expect(sofia.finalFee).toBeGreaterThan(0);
  });

  it('CASE 14: coordinates just above the configured distance boundary (8.01km) -> blocked — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices({ distanceKm: 8.01, durationMinutes: 30 });
    const input: CaseInput = { addressText: 'Carrera 10 # 5-20', route: { distanceKm: 8.01, durationMinutes: 30 }, withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).toBe('OUT_OF_COVERAGE');
    expect(pos.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
  });

  it('CASE 15: routing provider unavailable with trusted coordinates present -> fail-closed, never silently LOCAL_FREE from alias alone — both paths', async () => {
    const { pricingService, sofiaAdapter } = buildServices('UNAVAILABLE');
    const input: CaseInput = { addressText: 'alborada', route: 'UNAVAILABLE', withCoordinates: true };

    const sofia = await runSofiaPath(sofiaAdapter, input);
    const pos = await runLegacyPosPath(pricingService, input);

    expect(sofia.status).not.toBe('LOCAL_FREE');
    expect(pos.pricingStatus).not.toBe('LOCAL_FREE');
    expect(sofia.canCheckout).toBe(false);
    expect(pos.canCheckout).toBe(false);
    expect(sofia.finalFee).toBeNull();
    expect(pos.finalFee).toBeNull();
    expect(pos.warnings).toContain('ROUTING_UNAVAILABLE');
  });
});
