import { existsSync, readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

loadDotEnvWithoutOverriding();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(Boolean(process.env.GOOGLE_MAPS_API_KEY), 'GOOGLE_MAPS_API_KEY missing');
  assert(process.env.DELIVERY_PROVIDER_PRIMARY === 'google', 'primary provider is not google');
  assert(process.env.DELIVERY_ROUTING_PROVIDER === 'google', 'routing provider is not google');
  assert(process.env.DELIVERY_WEATHER_PROVIDER === 'openmeteo', 'weather provider is not openmeteo');
  assert(process.env.DELIVERY_GOOGLE_PLACES_ENABLED === 'true', 'google places disabled');
  assert(process.env.DELIVERY_GOOGLE_GEOCODING_ENABLED === 'true', 'google geocoding disabled');
  assert(process.env.DELIVERY_GOOGLE_ROUTES_ENABLED === 'true', 'google routes disabled');

  const [
    { PrismaService },
    { PrismaExternalCache },
    { DeliveryProviderUsageService },
    { DeliveryExternalDataService },
    { DeliveryPricingService },
    { DeliveryLocationService },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/delivery/providers/prisma-external-cache'),
    import('../src/delivery/providers/delivery-provider-usage.service'),
    import('../src/delivery/providers/delivery-external-data.service'),
    import('../src/delivery/delivery-pricing/delivery-pricing.service'),
    import('../src/delivery/delivery-location.service'),
  ]);

  const prisma = new PrismaService();
  await prisma.$connect();
  const cache = new PrismaExternalCache(prisma);
  const usage = new DeliveryProviderUsageService(prisma);
  const location = new DeliveryLocationService(cache, usage);
  const pricing = new DeliveryPricingService(new DeliveryExternalDataService(cache, usage), prisma);

  try {
    const search = await location.search({
      query: 'portal de jamundi',
      city: 'Jamundí',
      state: 'Valle del Cauca',
      country: 'Colombia',
    });
    assert(search.suggestions.length > 0, 'Google Places search returned no suggestions');
    const firstSuggestion = search.suggestions[0]!;

    const resolved = await location.resolve({
      provider: 'google',
      placeId: firstSuggestion.placeId,
      fallbackText: firstSuggestion.label,
    });
    assert(resolved.latitude != null && resolved.longitude != null, 'Google resolve did not return coordinates');

    const estimate = await pricing.estimate({
      addressText: resolved.formattedAddress ?? firstSuggestion.label,
      reference: resolved.formattedAddress ?? firstSuggestion.label,
      neighborhood: 'Jamundí',
      orderSubtotal: 52000,
      location: {
        provider: 'google',
        placeId: resolved.placeId,
        formattedAddress: resolved.formattedAddress,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        confidence: resolved.confidence,
      },
    });

    assert(estimate.status === 'AUTO_PRICED', `expected AUTO_PRICED, got ${estimate.status}`);
    assert(estimate.distanceKm != null && estimate.distanceKm > 0, 'Google route distance missing');
    assert(estimate.estimatedMinutes != null && estimate.estimatedMinutes > 0, 'Google route ETA missing');
    assert(estimate.providersUsed.routingProvider === 'google', 'Google routing provider not used');
    assert(estimate.providersUsed.weatherProvider === 'openmeteo', 'Open-Meteo weather provider not used');
    assert(estimate.weatherImpact != null, 'weather impact missing');
    assert(estimate.breakdown.some((item) => item.code === 'WEATHER_SURCHARGE'), 'weather surcharge breakdown missing');

    const weatherBreakdown = estimate.breakdown.find((item) => item.code === 'WEATHER_SURCHARGE');
    const rainIntensity = estimate.weatherImpact.rainIntensity;
    const surcharge = estimate.weatherImpact.surcharge;
    if (rainIntensity === 'NONE' || rainIntensity === 'UNKNOWN') {
      assert(surcharge === 0, 'no-rain weather must not apply surcharge');
      assert(weatherBreakdown?.amount === 0, 'no-rain breakdown must show zero weather surcharge');
    } else {
      assert(surcharge > 0, 'rain weather must apply surcharge');
      assert(weatherBreakdown != null && weatherBreakdown.amount > 0, 'rain breakdown must show surcharge');
    }

    const localFreeBeforeGoogleUsage = await googleUsageCount(prisma);
    const localFree = await pricing.estimate({
      addressText: 'Condados de la Alborada',
      neighborhood: 'Condados / Alborada',
      reference: 'Condados de la Alborada',
      orderSubtotal: 52000,
      weatherMode: 'HEAVY',
    });
    const localFreeAfterGoogleUsage = await googleUsageCount(prisma);
    assert(localFree.status === 'LOCAL_FREE', `expected LOCAL_FREE, got ${localFree.status}`);
    assert(localFree.finalFee === 0, 'LOCAL_FREE must remain COP 0');
    assert(localFree.weatherImpact.surcharge === 0, 'LOCAL_FREE must not apply rain surcharge');
    assert(localFreeAfterGoogleUsage === localFreeBeforeGoogleUsage, 'LOCAL_FREE should not call Google');

    console.log(JSON.stringify({
      ok: true,
      env: {
        googleMapsApiKey: '[SET]',
        primary: process.env.DELIVERY_PROVIDER_PRIMARY,
        routing: process.env.DELIVERY_ROUTING_PROVIDER,
        weather: process.env.DELIVERY_WEATHER_PROVIDER,
      },
      googleRoute: {
        status: estimate.status,
        distanceKm: estimate.distanceKm,
        estimatedMinutes: estimate.estimatedMinutes,
        providersUsed: estimate.providersUsed,
      },
      weather: {
        provider: estimate.weatherImpact.provider,
        rainIntensity,
        surcharge,
        breakdownAmount: weatherBreakdown?.amount ?? null,
      },
      localFreeRain: {
        status: localFree.status,
        finalFee: localFree.finalFee,
        weatherSurcharge: localFree.weatherImpact.surcharge,
        googleUsageDelta: localFreeAfterGoogleUsage - localFreeBeforeGoogleUsage,
      },
      providerUsage: await prisma.deliveryProviderUsage.findMany({
        where: { provider: { in: ['google', 'openmeteo'] } },
        orderBy: [{ provider: 'asc' }, { endpoint: 'asc' }],
        select: {
          provider: true,
          endpoint: true,
          requestCount: true,
          successCount: true,
          errorCount: true,
          lastStatus: true,
          circuitOpenUntil: true,
        },
      }),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function googleUsageCount(prisma: Pick<PrismaClient, 'deliveryProviderUsage'>) {
  const result = await prisma.deliveryProviderUsage.aggregate({
    where: { provider: 'google' },
    _sum: { requestCount: true },
  });
  return result._sum.requestCount ?? 0;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : 'UNKNOWN_GOOGLE_WEATHER_RAIN_SURCHARGE_SMOKE_ERROR',
  }));
  process.exitCode = 1;
});

function loadDotEnvWithoutOverriding() {
  const path = '../../.env';
  if (!existsSync(path)) return;

  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key] != null) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
