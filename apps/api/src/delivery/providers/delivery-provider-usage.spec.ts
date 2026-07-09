import { DeliveryProviderUsageService } from './delivery-provider-usage.service';
import type { PrismaService } from '../../prisma/prisma.service';

function prismaMock(record: unknown = null) {
  return {
    deliveryProviderUsage: {
      findUnique: jest.fn().mockResolvedValue(record),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

describe('DeliveryProviderUsageService quota and circuit breaker', () => {
  it('increments success usage', async () => {
    const prisma = prismaMock();

    await new DeliveryProviderUsageService(prisma).recordSuccess('openrouteservice', 'routing');

    expect(prisma.deliveryProviderUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          requestCount: { increment: 1 },
          successCount: { increment: 1 },
          lastStatus: 'SUCCESS',
        }),
      }),
    );
  });

  it('increments error usage and opens circuit after threshold', async () => {
    const prisma = prismaMock({ errorCount: 4, circuitOpenUntil: null, requestCount: 4 });
    process.env.DELIVERY_CIRCUIT_BREAKER_ERROR_THRESHOLD = '5';

    await new DeliveryProviderUsageService(prisma).recordError('openrouteservice', 'routing', 'ROUTING_UNAVAILABLE');

    expect(prisma.deliveryProviderUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          errorCount: { increment: 1 },
          circuitOpenUntil: expect.any(Date),
        }),
      }),
    );
  });

  it('returns soft limit warning', async () => {
    const prisma = prismaMock({ requestCount: 85, circuitOpenUntil: null });
    process.env.DELIVERY_PROVIDER_QUOTA_SOFT_LIMIT_PERCENT = '85';
    process.env.DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT = '95';

    const decision = await new DeliveryProviderUsageService(prisma).beforeCall('openrouteservice', 'routing', 100);

    expect(decision.allowed).toBe(true);
    expect(decision.warnings).toContain('PROVIDER_QUOTA_SOFT_LIMIT');
  });

  it('blocks hard limit', async () => {
    const prisma = prismaMock({ requestCount: 95, circuitOpenUntil: null });
    process.env.DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT = '95';

    const decision = await new DeliveryProviderUsageService(prisma).beforeCall('openrouteservice', 'routing', 100);

    expect(decision.allowed).toBe(false);
    expect(decision.warnings).toContain('PROVIDER_QUOTA_HARD_LIMIT');
  });

  it('blocks open circuit', async () => {
    const prisma = prismaMock({ requestCount: 2, circuitOpenUntil: new Date(Date.now() + 60_000) });

    const decision = await new DeliveryProviderUsageService(prisma).beforeCall('openrouteservice', 'routing', 100);

    expect(decision.allowed).toBe(false);
    expect(decision.warnings).toContain('PROVIDER_CIRCUIT_OPEN');
  });
});
