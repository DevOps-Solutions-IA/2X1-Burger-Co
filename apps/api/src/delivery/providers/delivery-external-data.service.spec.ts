import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeliveryPricingEngine } from '../delivery-pricing/delivery-pricing.engine';
import { DeliveryExternalDataService } from './delivery-external-data.service';
import type { GeocodingProvider } from './geocoding-provider.interface';
import { InMemoryExternalCache } from './in-memory-external-cache';
import { DeliveryProviderError } from './provider-errors';
import type { GeocodeResult, RouteResult, WeatherResult } from './provider-types';
import type { RoutingProvider } from './routing-provider.interface';
import type { WeatherProvider } from './weather-provider.interface';

const origin = {
  latitude: 3.2601,
  longitude: -76.5405,
  label: '2X1 Burger Co',
  address: 'Local principal',
};

function weatherResult(overrides: Partial<WeatherResult> = {}): WeatherResult {
  return {
    provider: 'mock-weather',
    isRaining: false,
    precipitationMm: 0,
    rainIntensity: 'NONE',
    confidence: 'HIGH',
    fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
    warnings: [],
    ...overrides,
  };
}

function geocodeResult(overrides: Partial<GeocodeResult> = {}): GeocodeResult {
  return {
    provider: 'mock-geocode',
    latitude: 3.258,
    longitude: -76.542,
    formattedAddress: 'Condados de la Alborada, Jamundí',
    neighborhood: 'Condados de la Alborada',
    matchQuality: 'EXACT',
    confidence: 'HIGH',
    warnings: [],
    ...overrides,
  };
}

function routeResult(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    provider: 'mock-route',
    distanceKm: 2.4,
    durationMinutes: 9,
    routeConfidence: 'HIGH',
    warnings: [],
    ...overrides,
  };
}

function buildProviders(overrides: {
  weather?: Partial<WeatherProvider>;
  geocoding?: Partial<GeocodingProvider>;
  routing?: Partial<RoutingProvider>;
} = {}) {
  const weatherProvider: WeatherProvider = {
    providerName: 'mock-weather',
    getCurrentWeather: jest.fn().mockResolvedValue(weatherResult()),
    ...overrides.weather,
  };
  const geocodingProvider: GeocodingProvider = {
    providerName: 'mock-geocode',
    geocodeAddress: jest.fn().mockResolvedValue(geocodeResult()),
    reverseGeocode: jest.fn().mockResolvedValue({
      provider: 'mock-geocode',
      formattedAddress: 'Condados de la Alborada',
      neighborhood: 'Condados de la Alborada',
      confidence: 'HIGH',
      warnings: [],
    }),
    ...overrides.geocoding,
  };
  const routingProvider: RoutingProvider = {
    providerName: 'mock-route',
    getRoute: jest.fn().mockResolvedValue(routeResult()),
    ...overrides.routing,
  };

  return { weatherProvider, geocodingProvider, routingProvider };
}

function serviceWithProviders(providers = buildProviders()) {
  return DeliveryExternalDataService.createForTesting({
    ...providers,
    cache: new InMemoryExternalCache(),
    providersEnabled: true,
    origin,
  });
}

describe('DeliveryExternalDataService provider architecture', () => {
  it('resolves weather with precipitation 0 as no rain', async () => {
    const providers = buildProviders({
      weather: { getCurrentWeather: jest.fn().mockResolvedValue(weatherResult({ precipitationMm: 0, isRaining: false, rainIntensity: 'NONE' })) },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.weather.attempted).toBe(true);
    expect(result.weather.isRaining).toBe(false);
    expect(result.weather.rainIntensity).toBe('NONE');
    expect(result.requiresManualQuote).toBe(false);
  });

  it('resolves weather with precipitation above 0 as raining', async () => {
    const providers = buildProviders({
      weather: { getCurrentWeather: jest.fn().mockResolvedValue(weatherResult({ precipitationMm: 3, isRaining: true, rainIntensity: 'MODERATE' })) },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.weather.isRaining).toBe(true);
    expect(result.weather.rainIntensity).toBe('MODERATE');
  });

  it('keeps operation available when weather times out', async () => {
    const providers = buildProviders({
      weather: {
        getCurrentWeather: jest.fn().mockRejectedValue(new DeliveryProviderError('timeout', 'WEATHER_UNAVAILABLE', 'mock-weather')),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.warnings).toContain('WEATHER_UNAVAILABLE');
    expect(result.requiresManualQuote).toBe(false);
  });

  it('accepts exact geocoding as high-confidence destination context', async () => {
    const providers = buildProviders({
      geocoding: { geocodeAddress: jest.fn().mockResolvedValue(geocodeResult({ matchQuality: 'EXACT', confidence: 'HIGH' })) },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'Carrera 22, Jamundí',
    });

    expect(result.geocoding.attempted).toBe(true);
    expect(result.destination.confidence).toBe('HIGH');
    expect(result.confidence).toBe('HIGH');
    expect(result.requiresManualQuote).toBe(false);
  });

  it('requires manual quote for ambiguous geocoding', async () => {
    const providers = buildProviders({
      geocoding: {
        geocodeAddress: jest.fn().mockResolvedValue(
          geocodeResult({
            latitude: null,
            longitude: null,
            matchQuality: 'AMBIGUOUS',
            confidence: 'LOW',
            warnings: ['GEOCODING_AMBIGUOUS'],
          }),
        ),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'destino ambiguo sin selección',
    });

    expect(result.warnings).toContain('GEOCODING_AMBIGUOUS');
    expect(result.confidence).toBe('LOW');
    expect(result.requiresManualQuote).toBe(true);
  });

  it('requires manual quote when geocoding cannot find the address', async () => {
    const providers = buildProviders({
      geocoding: {
        geocodeAddress: jest.fn().mockResolvedValue(
          geocodeResult({
            latitude: null,
            longitude: null,
            matchQuality: 'NOT_FOUND',
            confidence: 'LOW',
            warnings: ['GEOCODING_NOT_FOUND'],
          }),
        ),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'dirección imposible 999999',
    });

    expect(result.warnings).toContain('GEOCODING_NOT_FOUND');
    expect(result.requiresManualQuote).toBe(true);
  });

  it('resolves real route context without calculating delivery price', async () => {
    const result = await serviceWithProviders().resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.route.attempted).toBe(true);
    expect(result.route.distanceKm).toBe(2.4);
    expect(result.route.durationMinutes).toBe(9);
    expect(result).not.toHaveProperty('finalFee');
    expect(result).not.toHaveProperty('suggestedFee');
  });

  it('requires manual quote when routing is unavailable', async () => {
    const providers = buildProviders({
      routing: {
        getRoute: jest.fn().mockRejectedValue(new DeliveryProviderError('timeout', 'ROUTING_UNAVAILABLE', 'mock-route')),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.warnings).toContain('ROUTING_UNAVAILABLE');
    expect(result.requiresManualQuote).toBe(true);
  });

  it('uses haversine only as reference metadata, not as pricing authority', async () => {
    const result = await serviceWithProviders().resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.route.haversineReferenceKm).toEqual(expect.any(Number));
    expect(result.route.distanceKm).toBe(2.4);
    expect(result).not.toHaveProperty('finalFee');
  });

  it('requires manual quote when origin coordinates are missing', async () => {
    const result = await DeliveryExternalDataService.createForTesting({
      ...buildProviders(),
      cache: new InMemoryExternalCache(),
      providersEnabled: true,
      origin: { label: '2X1 Burger Co' },
    }).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.origin.configured).toBe(false);
    expect(result.warnings).toContain('ORIGIN_COORDINATES_MISSING');
    expect(result.requiresManualQuote).toBe(true);
  });

  it('attempts routing when destination coordinates are provided', async () => {
    const providers = buildProviders();

    await serviceWithProviders(providers).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(providers.routingProvider.getRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationLatitude: 3.258,
        destinationLongitude: -76.542,
        profile: 'MOTORCYCLE',
      }),
    );
  });

  it('matches Condados and Alborada aliases without applying a fee', async () => {
    const result = await serviceWithProviders().resolveDeliveryContext({
      addressText: 'Condados de la Alborada',
    });

    expect(result.localZoneMatch).toMatchObject({
      matched: true,
      zoneLabel: 'Condados de la Alborada',
      confidence: 'HIGH',
      ambiguous: false,
    });
    expect(result).not.toHaveProperty('finalFee');
  });

  it('marks near-alborada text as ambiguous instead of free-zone authority', async () => {
    const result = await serviceWithProviders().resolveDeliveryContext({
      addressText: 'cerca de alborada',
    });

    expect(result.localZoneMatch.ambiguous).toBe(true);
    expect(result.localZoneMatch.matched).toBe(false);
  });

  // SOFIA Address Remediation (TRUSTED_POST_GEOCODING_ZONE_HANDLING) — the ONE mechanism from the
  // prior remediation rounds that passed both automated red-team rounds cleanly and must be
  // preserved/re-verified this round: a zone-alias text match ("Alborada") is only a fallback used
  // when NO real point is already known. If the caller already supplies real coordinates alongside
  // the alias text (e.g. a WhatsApp live-location pin, or a client-side map pick), the service must
  // NOT take the bare-text zone shortcut — it must fall through to the normal
  // geocoding/routing/weather pipeline and let the real point drive routing + DeliveryPricingEngine's
  // ADDRESS_COMPLETE determination on its own merits, exactly like any other resolved destination.
  it('falls through to the real routing/weather pipeline instead of the bare zone-text shortcut when real coordinates are already known (TRUSTED_POST_GEOCODING_ZONE_HANDLING)', async () => {
    const providers = buildProviders();

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'Alborada',
      latitude: 3.258,
      longitude: -76.542,
    });

    // The zone match is still surfaced (fee-relevant metadata for the pricing engine) ...
    expect(result.localZoneMatch.matched).toBe(true);
    // ... but it did NOT short-circuit the pipeline: real routing/weather were actually attempted
    // and resolved against the real point, exactly as for any other already-geocoded destination.
    expect(result.route.attempted).toBe(true);
    expect(result.route.distanceKm).toBe(2.4);
    expect(result.route.durationMinutes).toBe(9);
    expect(result.weather.attempted).toBe(true);
    expect(providers.routingProvider.getRoute).toHaveBeenCalledWith(
      expect.objectContaining({ destinationLatitude: 3.258, destinationLongitude: -76.542 }),
    );
    expect(result.destination.latitude).toBe(3.258);
    expect(result.destination.longitude).toBe(-76.542);
    expect(result.requiresManualQuote).toBe(false);
  });

  it('still applies the bare zone-text shortcut (no routing/weather attempted) when no real coordinates are supplied alongside the alias', async () => {
    const providers = buildProviders();

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'Alborada',
    });

    expect(result.localZoneMatch.matched).toBe(true);
    expect(result.route.attempted).toBe(false);
    expect(result.weather.attempted).toBe(false);
    expect(providers.routingProvider.getRoute).not.toHaveBeenCalled();
    expect(providers.weatherProvider.getCurrentWeather).not.toHaveBeenCalled();
  });

  it('requires manual quote when every external provider fails', async () => {
    const providers = buildProviders({
      geocoding: {
        geocodeAddress: jest.fn().mockRejectedValue(new DeliveryProviderError('down', 'GEOCODING_UNAVAILABLE', 'mock-geocode')),
      },
      routing: {
        getRoute: jest.fn().mockRejectedValue(new DeliveryProviderError('down', 'ROUTING_UNAVAILABLE', 'mock-route')),
      },
      weather: {
        getCurrentWeather: jest.fn().mockRejectedValue(new DeliveryProviderError('down', 'WEATHER_UNAVAILABLE', 'mock-weather')),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'dirección externa sin resolver',
    });

    expect(result.warnings).toContain('GEOCODING_UNAVAILABLE');
    expect(result.requiresManualQuote).toBe(true);
  });

  it('caches provider responses and avoids repeated geocoding calls', async () => {
    const providers = buildProviders();
    const service = serviceWithProviders(providers);

    await service.resolveDeliveryContext({ addressText: 'Carrera 22, Jamundí' });
    await service.resolveDeliveryContext({ addressText: 'Carrera 22, Jamundí' });

    expect(providers.geocodingProvider.geocodeAddress).toHaveBeenCalledTimes(1);
  });
});

describe('DeliveryExternalDataService -> DeliveryPricingEngine end-to-end checkout authorization', () => {
  // SOFIA Address Remediation — end-to-end proof (not just hand-built engine fixtures) that a real
  // DeliveryExternalDataService.resolveDeliveryContext() context, fed straight into
  // DeliveryPricingEngine.quote(), produces the correct CAN_CHECKOUT for the
  // TRUSTED_POST_GEOCODING_ZONE_HANDLING scenario and leaves a normal AUTO_PRICED (non-zone)
  // address entirely unaffected by the zone-coverage wiring.
  const engine = new DeliveryPricingEngine();

  // SOFIA Address Remediation (A5 — TRUSTED_SPATIAL_DATA > TEXTUAL_ZONE_ALIAS). SUPERSEDES the
  // pre-A5 expectation of this test: a real pinned point is no longer trusted to be "in the free
  // zone" merely because a zone-alias text also matched. No real geofence/polygon authority for
  // Condados/Alborada exists in this codebase (see A5 report) — so once a real point is known, it
  // must flow through the SAME real distance/coverage pricing as any other destination. CAN_CHECKOUT
  // is still correctly granted here (the mocked route is a real, in-coverage 2.4km/9min trip) —
  // just via AUTO_PRICED with a real non-zero fee, never via the LOCAL_FREE text shortcut.
  it('grants CAN_CHECKOUT via real AUTO_PRICED distance pricing (never the LOCAL_FREE text shortcut) once a real geocoded/pinned point is already known', async () => {
    const service = serviceWithProviders();
    const request = { addressText: 'Alborada', latitude: 3.258, longitude: -76.542 };

    const context = await service.resolveDeliveryContext(request);
    const result = engine.quote({ ...request, context });

    expect(context.localZoneMatch.matched).toBe(true);
    expect(context.route.attempted).toBe(true);
    expect(context.route.distanceKm).toBe(2.4);
    expect(result.pricingStatus).toBe('AUTO_PRICED');
    expect(result.finalFee).toBeGreaterThan(0);
    expect(result.checkoutAuthorization.zoneMatched).toBe(true);
    expect(result.checkoutAuthorization.addressComplete).toBe(true);
    expect(result.checkoutAuthorization.coverageAllowed).toBe(true);
    expect(result.checkoutAuthorization.deliveryFeeResolved).toBe(true);
    expect(result.checkoutAuthorization.canCheckout).toBe(true);
    expect(result.canCheckout).toBe(true);
  });

  it('blocks CAN_CHECKOUT for a zone-alias address when the real pinned point is genuinely far outside coverage (the reported 42km bug)', async () => {
    const providers = buildProviders({
      routing: { getRoute: jest.fn().mockResolvedValue(routeResult({ distanceKm: 42, durationMinutes: 70 })) },
    });
    const service = serviceWithProviders(providers);
    const request = { addressText: 'Alborada', latitude: 3.258, longitude: -76.542 };

    const context = await service.resolveDeliveryContext(request);
    const result = engine.quote({ ...request, context });

    expect(context.localZoneMatch.matched).toBe(true);
    expect(context.route.distanceKm).toBe(42);
    expect(result.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(result.pricingStatus).not.toBe('LOCAL_FREE');
    expect(result.finalFee).toBeNull();
    expect(result.checkoutAuthorization.zoneMatched).toBe(true);
    expect(result.checkoutAuthorization.coverageAllowed).toBe(false);
    expect(result.checkoutAuthorization.canCheckout).toBe(false);
    expect(result.canCheckout).toBe(false);
  });

  it('blocks CAN_CHECKOUT for a bare zone-alias address with no real point and no structurally-complete complement', async () => {
    const service = serviceWithProviders();
    const request = { addressText: 'Alborada' };

    const context = await service.resolveDeliveryContext(request);
    const result = engine.quote({ ...request, context });

    expect(context.localZoneMatch.matched).toBe(true);
    expect(context.route.attempted).toBe(false);
    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.finalFee).toBe(0);
    expect(result.checkoutAuthorization.zoneMatched).toBe(true);
    expect(result.checkoutAuthorization.addressComplete).toBe(false);
    expect(result.checkoutAuthorization.canCheckout).toBe(false);
    expect(result.canCheckout).toBe(false);
  });

  it('leaves a normal AUTO_PRICED (non-zone) address unaffected by the zone-coverage wiring', async () => {
    const service = serviceWithProviders();
    const request = { addressText: 'Carrera 22, Jamundí' };

    const context = await service.resolveDeliveryContext(request);
    const result = engine.quote({ ...request, context });

    expect(context.localZoneMatch.matched).toBe(false);
    expect(result.pricingStatus).toBe('AUTO_PRICED');
    expect(result.checkoutAuthorization.zoneMatched).toBe(false);
    expect(result.checkoutAuthorization.addressComplete).toBe(true);
    expect(result.checkoutAuthorization.coverageAllowed).toBe(true);
    expect(result.checkoutAuthorization.deliveryFeeResolved).toBe(true);
    expect(result.checkoutAuthorization.canCheckout).toBe(true);
    expect(result.canCheckout).toBe(true);
    expect(result.finalFee).toBeGreaterThan(0);
  });
});

describe('AUDIT-8G reset regression guards', () => {
  it('does not restore automatic 5000 fallback in reset pricing engine', () => {
    const result = new DeliveryPricingEngine().quote({ addressText: 'Destino desconocido' });

    expect(result.requiresManualQuote).toBe(true);
    expect(result.finalFee).toBeNull();
    expect(result.finalFee).not.toBe(5000);
  });

  it('keeps OrdersService coupled to delivery boundary, not legacy delivery-zones pricing', () => {
    const source = readFileSync(join(process.cwd(), 'src/modules/orders/orders.service.ts'), 'utf8');

    expect(source).toContain('DeliveryPricingService');
    expect(source).not.toContain("from './delivery-zones'");
    expect(source).not.toContain("from \"./delivery-zones\"");
  });

  it('keeps legacy delivery zones explicitly disabled outside final pricing', () => {
    const source = readFileSync(join(process.cwd(), 'src/delivery/delivery-pricing/delivery-pricing.legacy.ts'), 'utf8');

    expect(source).toContain('LEGACY - NOT ACTIVE - DO NOT USE FOR FINAL DELIVERY PRICING');
    expect(source).toContain('LEGACY_DELIVERY_PRICING_DISABLED');
  });
});
