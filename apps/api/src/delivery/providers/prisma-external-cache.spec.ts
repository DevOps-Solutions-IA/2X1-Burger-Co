import { DeliveryExternalDataService } from './delivery-external-data.service';
import type { ExternalCache, ExternalCacheLookup } from './external-cache.interface';
import { PrismaExternalCache } from './prisma-external-cache';
import type { GeocodingProvider } from './geocoding-provider.interface';
import type { RoutingProvider } from './routing-provider.interface';
import type { WeatherProvider } from './weather-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';

const baseEntry: ExternalCacheLookup = {
  provider: 'openmeteo',
  cacheType: 'WEATHER_CURRENT',
  cacheKey: 'current:3.26010:-76.54050',
};

function buildPrismaMock() {
  return {
    externalApiCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('PrismaExternalCache', () => {
  it('set + get returns value before expiresAt', async () => {
    const prisma = buildPrismaMock();
    jest.spyOn(prisma.externalApiCache, 'findUnique').mockResolvedValue({
      id: 'cache-1',
      provider: baseEntry.provider,
      cacheType: baseEntry.cacheType,
      cacheKey: baseEntry.cacheKey,
      requestHash: 'hash',
      responseJson: { isRaining: false },
      status: 'SUCCESS',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const cache = new PrismaExternalCache(prisma);
    const value = await cache.get<{ isRaining: boolean }>(baseEntry);

    expect(value).toEqual({ isRaining: false });
  });

  it('get returns null if cache expired and marks record as stale', async () => {
    const prisma = buildPrismaMock();
    jest.spyOn(prisma.externalApiCache, 'findUnique').mockResolvedValue({
      id: 'cache-expired',
      provider: baseEntry.provider,
      cacheType: baseEntry.cacheType,
      cacheKey: baseEntry.cacheKey,
      requestHash: 'hash',
      responseJson: { isRaining: true },
      status: 'SUCCESS',
      expiresAt: new Date(Date.now() - 1_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    jest.spyOn(prisma.externalApiCache, 'update').mockResolvedValue({} as never);

    const cache = new PrismaExternalCache(prisma);
    const value = await cache.get(baseEntry);

    expect(value).toBeNull();
    expect(prisma.externalApiCache.update).toHaveBeenCalledWith({
      where: { id: 'cache-expired' },
      data: { status: 'STALE' },
    });
  });

  it('set uses upsert on the provider/cacheType/cacheKey unique key', async () => {
    const prisma = buildPrismaMock();
    jest.spyOn(prisma.externalApiCache, 'upsert').mockResolvedValue({} as never);

    const cache = new PrismaExternalCache(prisma);
    await cache.set(baseEntry, { ok: true }, 900);
    await cache.set(baseEntry, { ok: false }, 900);

    expect(prisma.externalApiCache.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.externalApiCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_cacheType_cacheKey: {
            provider: baseEntry.provider,
            cacheType: baseEntry.cacheType,
            cacheKey: baseEntry.cacheKey,
          },
        },
      }),
    );
  });

  it('delete removes the exact provider/cacheType/cacheKey entry', async () => {
    const prisma = buildPrismaMock();
    jest.spyOn(prisma.externalApiCache, 'deleteMany').mockResolvedValue({ count: 1 });

    const cache = new PrismaExternalCache(prisma);
    await cache.delete(baseEntry);

    expect(prisma.externalApiCache.deleteMany).toHaveBeenCalledWith({
      where: {
        provider: baseEntry.provider,
        cacheType: baseEntry.cacheType,
        cacheKey: baseEntry.cacheKey,
      },
    });
  });

  it('preserves responseJson and writes status SUCCESS with expiration', async () => {
    const prisma = buildPrismaMock();
    jest.spyOn(prisma.externalApiCache, 'upsert').mockResolvedValue({} as never);
    const payload = { distanceKm: 2.4, durationMinutes: 9 };

    await new PrismaExternalCache(prisma).set(
      {
        provider: 'osrm',
        cacheType: 'ROUTE_DISTANCE',
        cacheKey: 'route:1:2:3:4:MOTORCYCLE',
      },
      payload,
      60,
    );

    expect(prisma.externalApiCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          responseJson: payload,
          status: 'SUCCESS',
          expiresAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          responseJson: payload,
          status: 'SUCCESS',
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe('DeliveryExternalDataService cache integration', () => {
  const weatherProvider: WeatherProvider = {
    providerName: 'openmeteo',
    getCurrentWeather: jest.fn().mockResolvedValue({
      provider: 'openmeteo',
      isRaining: false,
      precipitationMm: 0,
      rainIntensity: 'NONE',
      confidence: 'HIGH',
      fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
      warnings: [],
    }),
  };
  const geocodingProvider: GeocodingProvider = {
    providerName: 'nominatim',
    geocodeAddress: jest.fn().mockResolvedValue({
      provider: 'nominatim',
      latitude: 3.258,
      longitude: -76.542,
      formattedAddress: 'Condados de la Alborada',
      neighborhood: 'Condados de la Alborada',
      matchQuality: 'EXACT',
      confidence: 'HIGH',
      warnings: [],
    }),
    reverseGeocode: jest.fn(),
  };
  const routingProvider: RoutingProvider = {
    providerName: 'osrm',
    getRoute: jest.fn().mockResolvedValue({
      provider: 'osrm',
      distanceKm: 2.4,
      durationMinutes: 9,
      routeConfidence: 'HIGH',
      warnings: [],
    }),
  };

  function serviceWithCache(cache: ExternalCache) {
    return DeliveryExternalDataService.createForTesting({
      cache,
      providersEnabled: true,
      weatherProvider,
      geocodingProvider,
      routingProvider,
      origin: {
        latitude: 3.2601,
        longitude: -76.5405,
        label: '2X1 Burger Co',
        address: 'Local principal',
      },
    });
  }

  it('does not break context resolution if cache fails', async () => {
    const failingCache: ExternalCache = {
      get: jest.fn().mockRejectedValue(new Error('cache unavailable')),
      set: jest.fn().mockRejectedValue(new Error('cache unavailable')),
      delete: jest.fn(),
    };

    const result = await serviceWithCache(failingCache).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(result.warnings).toContain('CACHE_UNAVAILABLE');
    expect(result.route.distanceKm).toBe(2.4);
  });

  it('uses 15 minute TTL for weather cache', async () => {
    const cache = buildSpyCache();

    await serviceWithCache(cache).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ cacheType: 'WEATHER_CURRENT' }),
      expect.any(Object),
      15 * 60,
    );
  });

  it('uses 90 day TTL for geocode cache', async () => {
    const cache = buildSpyCache();

    await serviceWithCache(cache).resolveDeliveryContext({
      addressText: 'Carrera 22, Jamundí',
    });

    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ cacheType: 'GEOCODE_ADDRESS' }),
      expect.any(Object),
      90 * 24 * 60 * 60,
    );
  });

  it('uses 14 day TTL for route cache', async () => {
    const cache = buildSpyCache();

    await serviceWithCache(cache).resolveDeliveryContext({
      latitude: 3.258,
      longitude: -76.542,
    });

    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ cacheType: 'ROUTE_DISTANCE' }),
      expect.any(Object),
      14 * 24 * 60 * 60,
    );
  });
});

function buildSpyCache(): ExternalCache {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}
