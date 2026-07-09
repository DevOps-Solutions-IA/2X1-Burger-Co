import { existsSync, readFileSync } from 'node:fs';

type ProviderUsageRow = {
  provider: string;
  endpoint: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  lastStatus: string | null;
  circuitOpenUntil: Date | null;
};

type CacheRow = {
  provider: string;
  cacheType: string;
  status: string;
  expiresAt: Date;
};

process.env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED = 'true';
process.env.DELIVERY_EXTERNAL_SMOKE_ENABLED = 'true';
process.env.DELIVERY_CACHE_ENABLED = process.env.DELIVERY_CACHE_ENABLED ?? 'true';

loadDotEnvWithoutOverriding();
process.env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED = 'true';
process.env.DELIVERY_EXTERNAL_SMOKE_ENABLED = 'true';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
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
  const cache = new PrismaExternalCache(prisma);
  const usage = new DeliveryProviderUsageService(prisma);
  const external = new DeliveryExternalDataService(cache, usage);
  const pricing = new DeliveryPricingService(external, prisma);

  const request = {
    addressText: 'Alfaguara Mall, Jamundi, Valle del Cauca',
    neighborhood: 'Jamundi',
    reference: 'Direccion de prueba para smoke tecnico',
    orderSubtotal: 52000,
  };

  const since = new Date(Date.now() - 30_000);
  const beforeCache = await prisma.externalApiCache.count();

  const first = await pricing.estimate(request);
  const afterFirstCache = await prisma.externalApiCache.count();
  const second = await pricing.estimate(request);
  const afterSecondCache = await prisma.externalApiCache.count();

  const usageDate = startOfUtcDay(new Date());
  const providerUsage = await prisma.deliveryProviderUsage.findMany({
    where: {
      usageDate,
      provider: { in: ['openrouteservice', 'openmeteo'] },
    },
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
  }) as ProviderUsageRow[];

  const cacheRows = await prisma.externalApiCache.findMany({
    where: {
      provider: { in: ['openrouteservice', 'openmeteo'] },
      updatedAt: { gte: since },
    },
    orderBy: [{ provider: 'asc' }, { cacheType: 'asc' }],
    select: {
      provider: true,
      cacheType: true,
      status: true,
      expiresAt: true,
    },
  }) as CacheRow[];

  const providers = second.providersUsed ?? second.providerUsage ?? {};
  const warnings = second.warnings ?? [];

  assert(first.calculationVersion === '2x1-delivery-pricing-v1', 'calculationVersion missing');
  assert(second.calculationVersion === '2x1-delivery-pricing-v1', 'calculationVersion missing on cached pass');
  assert(Array.isArray(second.breakdown) && second.breakdown.length > 0, 'breakdown missing');
  assert(providers.geocodingProvider === 'openrouteservice', 'OpenRouteService geocoding not used');
  assert(providers.routingProvider === 'openrouteservice', 'OpenRouteService routing not used');
  assert(providers.weatherProvider === 'openmeteo', 'Open-Meteo weather not used');
  assert(second.distanceKm != null && second.distanceKm > 0, 'routing distance missing');
  assert(second.estimatedMinutes != null && second.estimatedMinutes > 0, 'routing ETA missing');
  assert(second.status === 'AUTO_PRICED', `expected AUTO_PRICED, got ${second.status}`);
  assert(second.finalFee != null && second.finalFee > 0, 'AUTO_PRICED final fee missing');
  assert(second.canCheckout === true, 'AUTO_PRICED must allow checkout');
  assert(cacheRows.some((row) => row.provider === 'openrouteservice' && row.cacheType === 'GEOCODE_ADDRESS'), 'geocoding cache evidence missing');
  assert(cacheRows.some((row) => row.provider === 'openrouteservice' && row.cacheType === 'ROUTE_DISTANCE'), 'routing cache evidence missing');
  assert(cacheRows.some((row) => row.provider === 'openmeteo' && row.cacheType === 'WEATHER_CURRENT'), 'weather cache evidence missing');
  assert(providerUsage.some((row) => row.provider === 'openrouteservice' && row.endpoint === 'geocoding' && row.successCount > 0), 'geocoding usage success missing');
  assert(providerUsage.some((row) => row.provider === 'openrouteservice' && row.endpoint === 'routing' && row.successCount > 0), 'routing usage success missing');
  assert(providerUsage.some((row) => row.provider === 'openmeteo' && row.endpoint === 'weather' && row.successCount > 0), 'weather usage success missing');
  assert(providerUsage.every((row) => !row.circuitOpenUntil || row.circuitOpenUntil <= new Date()), 'provider circuit breaker is open');

  console.log(JSON.stringify({
    ok: true,
    request: {
      addressText: request.addressText,
      neighborhood: request.neighborhood,
      reference: 'smoke tecnico',
      orderSubtotal: request.orderSubtotal,
    },
    first: {
      status: first.status,
      finalFee: first.finalFee,
      canCheckout: first.canCheckout,
      distanceKm: first.distanceKm,
      estimatedMinutes: first.estimatedMinutes,
      providersUsed: first.providersUsed,
      weatherImpact: first.weatherImpact,
      warnings: first.warnings,
    },
    second: {
      status: second.status,
      finalFee: second.finalFee,
      canCheckout: second.canCheckout,
      distanceKm: second.distanceKm,
      estimatedMinutes: second.estimatedMinutes,
      providersUsed: second.providersUsed,
      weatherImpact: second.weatherImpact,
      warnings,
    },
    cache: {
      beforeCache,
      afterFirstCache,
      afterSecondCache,
      rows: cacheRows,
      secondCallCacheStable: afterSecondCache === afterFirstCache,
    },
    providerUsage,
    quotaCircuit: {
      circuitOpen: providerUsage.some((row) => row.circuitOpenUntil && row.circuitOpenUntil > new Date()),
      errors: providerUsage.reduce((total, row) => total + row.errorCount, 0),
    },
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : 'UNKNOWN_SMOKE_ERROR',
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
