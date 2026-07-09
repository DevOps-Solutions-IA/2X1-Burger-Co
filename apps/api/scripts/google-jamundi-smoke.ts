import { existsSync, readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

loadDotEnvWithoutOverriding();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(Boolean(process.env.GOOGLE_MAPS_API_KEY), 'GOOGLE_MAPS_API_KEY missing');
  assert(process.env.DELIVERY_PROVIDER_PRIMARY === 'google', 'primary provider is not google');
  assert(process.env.DELIVERY_PLACES_PROVIDER === 'google', 'places provider is not google');
  assert(process.env.DELIVERY_GEOCODING_PROVIDER === 'google', 'geocoding provider is not google');
  assert(process.env.DELIVERY_ROUTING_PROVIDER === 'google', 'routing provider is not google');
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
    const beforeGoogleUsage = await googleUsageCount(prisma);
    const localFree = await pricing.estimate({
      addressText: 'Condados de la Alborada',
      neighborhood: 'Condados / Alborada',
      reference: 'Condados de la Alborada',
      orderSubtotal: 52000,
    });
    const afterLocalGoogleUsage = await googleUsageCount(prisma);
    assert(localFree.status === 'LOCAL_FREE', `expected LOCAL_FREE, got ${localFree.status}`);
    assert(localFree.finalFee === 0, 'LOCAL_FREE must be COP 0');
    assert(localFree.canCheckout === true, 'LOCAL_FREE must allow checkout');
    assert(afterLocalGoogleUsage === beforeGoogleUsage, 'LOCAL_FREE should not call Google providers');

    const search = await location.search({
      query: 'portal de jamundi',
      city: 'Jamundí',
      state: 'Valle del Cauca',
      country: 'Colombia',
    });
    assert(search.suggestions.length > 0, 'Google Places search returned no suggestions');
    const firstSuggestion = search.suggestions[0]!;
    assert(firstSuggestion.provider === 'google', 'suggestion provider must be google');

    const resolved = await location.resolve({
      provider: 'google',
      placeId: firstSuggestion.placeId,
      fallbackText: firstSuggestion.label,
    });
    assert(resolved.latitude != null && resolved.longitude != null, 'Google resolve did not return coordinates');
    assert(resolved.confidence !== 'LOW', 'Google resolve confidence is low');

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
    assert(estimate.canCheckout === true, 'AUTO_PRICED must allow checkout');
    assert(estimate.finalFee != null && estimate.finalFee > 0, 'AUTO_PRICED final fee missing');
    assert(estimate.distanceKm != null && estimate.distanceKm > 0, 'Google route distance missing');
    assert(estimate.estimatedMinutes != null && estimate.estimatedMinutes > 0, 'Google route ETA missing');
    assert(estimate.providersUsed.geocodingProvider === 'google', 'Google geocoding provider not preserved');
    assert(estimate.providersUsed.routingProvider === 'google', 'Google routing provider not used');

    const invalid = await pricing.estimate({
      addressText: '',
      reference: '',
      orderSubtotal: 10000,
    });
    assert(invalid.canCheckout === false, 'invalid address must block checkout');
    assert(invalid.finalFee == null, 'invalid address must not return a final fee');

    const providerUsage = await prisma.deliveryProviderUsage.findMany({
      where: { provider: 'google' },
      orderBy: [{ endpoint: 'asc' }],
      select: {
        provider: true,
        endpoint: true,
        requestCount: true,
        successCount: true,
        errorCount: true,
        lastStatus: true,
        circuitOpenUntil: true,
      },
    });

    console.log(JSON.stringify({
      ok: true,
      env: {
        googleMapsApiKey: '[SET]',
        primary: process.env.DELIVERY_PROVIDER_PRIMARY,
        places: process.env.DELIVERY_PLACES_PROVIDER,
        geocoding: process.env.DELIVERY_GEOCODING_PROVIDER,
        routing: process.env.DELIVERY_ROUTING_PROVIDER,
      },
      localFree: {
        status: localFree.status,
        finalFee: localFree.finalFee,
        canCheckout: localFree.canCheckout,
        googleUsageDelta: afterLocalGoogleUsage - beforeGoogleUsage,
      },
      search: {
        count: search.suggestions.length,
        first: {
          provider: firstSuggestion.provider,
          label: firstSuggestion.label,
          confidence: firstSuggestion.confidence,
        },
      },
      resolve: {
        provider: resolved.provider,
        hasPlaceId: Boolean(resolved.placeId),
        hasCoordinates: resolved.latitude != null && resolved.longitude != null,
        confidence: resolved.confidence,
      },
      estimate: {
        status: estimate.status,
        finalFee: estimate.finalFee,
        canCheckout: estimate.canCheckout,
        distanceKm: estimate.distanceKm,
        estimatedMinutes: estimate.estimatedMinutes,
        providersUsed: estimate.providersUsed,
      },
      invalid: {
        status: invalid.status,
        canCheckout: invalid.canCheckout,
        finalFee: invalid.finalFee,
        humanMessage: invalid.humanMessage,
      },
      providerUsage,
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
    error: error instanceof Error ? error.message : 'UNKNOWN_GOOGLE_JAMUNDI_SMOKE_ERROR',
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
