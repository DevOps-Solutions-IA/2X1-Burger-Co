import { existsSync, readFileSync } from 'node:fs';

type SmokeResult = {
  name: string;
  status: string;
  canCheckout: boolean;
  finalFee: number | null;
  distanceKm: number | null;
  estimatedMinutes: number | null;
  providersUsed: unknown;
  warnings: string[];
};

loadDotEnvWithoutOverriding();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(process.env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED === 'true', 'providers must be enabled by process env for this smoke');
  assert(process.env.DELIVERY_EXTERNAL_SMOKE_ENABLED === 'true', 'external smoke must be enabled by process env for this smoke');
  assert(Boolean(process.env.OPENROUTESERVICE_API_KEY), 'OpenRouteService key missing');

  const [
    { DeliveryPricingService },
    { PrismaService },
    { PrismaExternalCache },
    { DeliveryProviderUsageService },
    { DeliveryExternalDataService },
  ] = await Promise.all([
    import('../src/delivery/delivery-pricing/delivery-pricing.service'),
    import('../src/prisma/prisma.service'),
    import('../src/delivery/providers/prisma-external-cache'),
    import('../src/delivery/providers/delivery-provider-usage.service'),
    import('../src/delivery/providers/delivery-external-data.service'),
  ]);

  const prisma = new PrismaService();
  await prisma.$connect();
  const external = new DeliveryExternalDataService(new PrismaExternalCache(prisma), new DeliveryProviderUsageService(prisma));
  const pricing = new DeliveryPricingService(external, prisma);

  try {
    const poi = await pricing.estimate({
      addressText: 'Portal de Jamundí, Jamundí, Valle del Cauca, Colombia',
      neighborhood: 'Jamundí',
      reference: 'Dirección de prueba para smoke técnico',
      orderSubtotal: 52000,
      city: 'Jamundí',
      state: 'Valle del Cauca',
      country: 'Colombia',
    });

    const composed = await pricing.estimate({
      addressText: 'calle 11 2as # 167',
      neighborhood: 'portal de jamundi',
      reference: 'Dirección de prueba para smoke técnico',
      orderSubtotal: 52000,
      city: 'Jamundí',
      state: 'Valle del Cauca',
      country: 'Colombia',
    });

    const localFree = await pricing.estimate({
      addressText: 'Condados de la Alborada',
      neighborhood: 'Condados / Alborada',
      reference: 'Dirección de prueba para smoke técnico',
      orderSubtotal: 52000,
      city: 'Jamundí',
      state: 'Valle del Cauca',
      country: 'Colombia',
    });

    assert(poi.status !== 'NEEDS_ADDRESS_CORRECTION' || !poi.warnings.includes('DESTINATION_MISSING'), 'POI returned DESTINATION_MISSING');
    assert(poi.distanceKm == null || poi.distanceKm > 0, 'POI distance must be positive when present');
    assert(poi.estimatedMinutes == null || poi.estimatedMinutes > 0, 'POI ETA must be positive when present');
    assert(Array.isArray(poi.breakdown) && poi.breakdown.length > 0, 'POI breakdown missing');

    assert(composed.status !== 'LOCAL_FREE' || composed.finalFee === 0, 'composed local-free status must keep COP 0 only when valid');
    if (composed.canCheckout === false) {
      assert(composed.finalFee == null, 'blocked composed address must not return final fee');
    }

    assert(localFree.status === 'LOCAL_FREE', `expected LOCAL_FREE, got ${localFree.status}`);
    assert(localFree.finalFee === 0, 'LOCAL_FREE final fee must be 0');
    assert(localFree.canCheckout === true, 'LOCAL_FREE must allow checkout');

    const results: SmokeResult[] = [
      toSmokeResult('poi', poi),
      toSmokeResult('composed', composed),
      toSmokeResult('localFree', localFree),
    ];

    console.log(JSON.stringify({
      ok: true,
      env: {
        providersEnabled: process.env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED,
        smokeEnabled: process.env.DELIVERY_EXTERNAL_SMOKE_ENABLED,
        geocodingProvider: process.env.DELIVERY_GEOCODING_PROVIDER,
        routingProvider: process.env.DELIVERY_ROUTING_PROVIDER,
        weatherProvider: process.env.DELIVERY_WEATHER_PROVIDER,
        openRouteServiceApiKey: '[SET]',
      },
      cases: results,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function toSmokeResult(name: string, result: {
  status: string;
  canCheckout: boolean;
  finalFee: number | null;
  distanceKm: number | null;
  estimatedMinutes: number | null;
  providersUsed: unknown;
  warnings: string[];
}): SmokeResult {
  return {
    name,
    status: result.status,
    canCheckout: result.canCheckout,
    finalFee: result.finalFee,
    distanceKm: result.distanceKm,
    estimatedMinutes: result.estimatedMinutes,
    providersUsed: result.providersUsed,
    warnings: result.warnings,
  };
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : 'UNKNOWN_RUNTIME_ADDRESS_SMOKE_ERROR',
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
