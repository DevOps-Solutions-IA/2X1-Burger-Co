import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObservabilityService } from './observability.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const originalExpected = process.env.EXPECTED_MIGRATION_COUNT;
  const observability = {
    recordReadinessFailure: jest.fn(),
    snapshot: jest.fn().mockResolvedValue({ status: 'READY' }),
  } as unknown as ObservabilityService;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalExpected === undefined) delete process.env.EXPECTED_MIGRATION_COUNT;
    else process.env.EXPECTED_MIGRATION_COUNT = originalExpected;
  });

  it('keeps liveness independent from the database', () => {
    const service = new HealthService({} as PrismaService, observability);
    expect(service.liveness()).toMatchObject({ status: 'ALIVE' });
  });

  it('reports readiness only when migrations are compatible', async () => {
    process.env.EXPECTED_MIGRATION_COUNT = '29';
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ applied: 29n, failed: 0n }]),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability);
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'READY',
      checks: { appliedMigrations: 29, expectedMigrations: 29, migrationCompatible: true },
    });
  });

  it('fails readiness when schema compatibility is wrong', async () => {
    process.env.EXPECTED_MIGRATION_COUNT = '30';
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ applied: 29n, failed: 0n }]),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability);
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(observability.recordReadinessFailure).toHaveBeenCalledTimes(1);
  });

  it('fails readiness but not liveness when the database is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability);
    expect(service.liveness().status).toBe('ALIVE');
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
