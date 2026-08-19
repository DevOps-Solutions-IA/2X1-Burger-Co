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

  it('does not let an alias embedded in a full address bypass geocoding (real geocoding runs instead)', async () => {
    const providers = buildProviders({
      geocoding: {
        geocodeAddress: jest.fn().mockResolvedValue(
          geocodeResult({
            matchQuality: 'EXACT',
            confidence: 'HIGH',
            latitude: 3.19,
            longitude: -76.61,
            neighborhood: 'Lejos de Condados',
          }),
        ),
      },
    });

    const result = await serviceWithProviders(providers).resolveDeliveryContext({
      addressText: 'Calle 15 #45-67 barrio condados sector industrial, muy lejos del local',
    });

    expect(result.localZoneMatch.matched).toBe(false);
    expect(providers.geocodingProvider.geocodeAddress).toHaveBeenCalledTimes(1);
    expect(result.geocoding.attempted).toBe(true);
    expect(result.destination.latitude).toBe(3.19);
    expect(result.destination.longitude).toBe(-76.61);
  });

  it('does not call external providers or grant LOCAL_FREE when DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false and the address is a full address embedding the alias', async () => {
    const providers = buildProviders();
    const service = DeliveryExternalDataService.createForTesting({
      ...providers,
      cache: new InMemoryExternalCache(),
      providersEnabled: false,
      origin,
    });

    const result = await service.resolveDeliveryContext({
      addressText: 'Carrera 10 con 20 apto 302 condados',
    });

    expect(result.localZoneMatch.matched).toBe(false);
    expect(providers.geocodingProvider.geocodeAddress).not.toHaveBeenCalled();
    expect(result.warnings).toContain('EXTERNAL_PROVIDERS_DISABLED');
    expect(result.requiresManualQuote).toBe(true);
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
