import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObservabilityService } from './observability.service';
import type { ReleaseMetadataService } from '../../release/release-metadata.service';
import type { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const inventory = Array.from({ length: 30 }, (_, index) => ({
    name: `20260701${String(index).padStart(6, '0')}_migration_${index}`,
    checksum: String(index).padStart(64, '0'),
  }));
  const observability = {
    recordReadinessFailure: jest.fn(),
    snapshot: jest.fn().mockResolvedValue({ status: 'READY' }),
  } as unknown as ObservabilityService;
  const safetyFlags = {
    realSendingEnabled: false as const,
    autoReplyEnabled: false as const,
    autoSafeEnabled: false as const,
    productionEnabled: false as const,
    whatsappCanMarkPaid: false as const,
  };
  const config = { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService;
  const releaseMetadata = {
    getEnvironment: jest.fn().mockReturnValue('test'),
    getSchemaMigrationCount: jest.fn().mockReturnValue(30),
    getMigrationInventory: jest.fn().mockReturnValue(inventory),
    getMigrationAttestations: jest.fn().mockReturnValue([]),
    getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
  } as unknown as ReleaseMetadataService;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps liveness independent from the database', () => {
    const service = new HealthService(
      {} as PrismaService,
      observability,
      releaseMetadata,
      config,
    );
    expect(service.liveness()).toMatchObject({ status: 'ALIVE' });
  });

  it('reports readiness only when migrations are compatible', async () => {
    const testInventory = inventory.slice(0, 29);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(appliedRows(testInventory)),
    } as unknown as PrismaService;
    const release = {
      getEnvironment: jest.fn().mockReturnValue('test'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(29),
      getMigrationInventory: jest.fn().mockReturnValue(testInventory),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const service = new HealthService(prisma, observability, release, config);
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'READY',
      checks: { appliedMigrations: 29, expectedMigrations: 29, migrationCompatible: true },
    });
  });

  it('fails readiness when schema compatibility is wrong', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory.slice(0, 29))),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability, releaseMetadata, config);
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(observability.recordReadinessFailure).toHaveBeenCalledTimes(1);
  });

  it('uses the release manifest schema expectation when no override exists', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability, releaseMetadata, config);

    await expect(service.readiness()).resolves.toMatchObject({
      checks: { appliedMigrations: 30, expectedMigrations: 30, migrationCompatible: true },
    });
  });

  it('fails closed in a release environment without a schema expectation', async () => {
    const releaseWithoutSchema = {
      getEnvironment: jest.fn().mockReturnValue('staging'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(null),
      getMigrationInventory: jest.fn().mockReturnValue([]),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)),
    } as unknown as PrismaService;
    const service = new HealthService(
      prisma,
      observability,
      releaseWithoutSchema,
      config,
    );

    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails readiness but not liveness when the database is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability, releaseMetadata, config);
    expect(service.liveness().status).toBe('ALIVE');
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the public aggregate health check cheap and independent from the database', () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)),
    } as unknown as PrismaService;
    const service = new HealthService(prisma, observability, releaseMetadata, config);

    expect(service.check()).toMatchObject({ status: 'ok', environment: 'test' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed in a release environment when a migration checksum differs', async () => {
    const release = {
      getEnvironment: jest.fn().mockReturnValue('staging'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(30),
      getMigrationInventory: jest.fn().mockReturnValue(inventory),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const rows = appliedRows(inventory);
    rows[29]!.checksum = 'f'.repeat(64);
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) } as unknown as PrismaService;

    await expect(
      new HealthService(prisma, observability, release, config).readiness(),
    ).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('verifies exact migration identity in a release environment', async () => {
    const release = {
      getEnvironment: jest.fn().mockReturnValue('staging'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(30),
      getMigrationInventory: jest.fn().mockReturnValue(inventory),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)) } as unknown as PrismaService;

    await expect(
      new HealthService(prisma, observability, release, config).readiness(),
    ).resolves.toMatchObject({
      status: 'READY',
      checks: { migrationCompatible: true, migrationIdentityVerified: true },
    });
  });

  it('keeps a release ready only for the exact owner-attested forward migration', async () => {
    const frontier37 = repositoryInventory();
    const rows = appliedRows(frontier37);
    rows.push({
      migrationName: '20260812130000_sofia_crm_product_core',
      checksum: '64e17e19f394af2e0781032025e1afb293987bda7f95d7c53ed3345800bf1fdd',
      finished: true,
      rolledBack: false,
    });
    const release = {
      getEnvironment: jest.fn().mockReturnValue('production'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(37),
      getMigrationInventory: jest.fn().mockReturnValue(frontier37),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) } as unknown as PrismaService;

    await expect(new HealthService(prisma, observability, release, config).readiness()).resolves.toMatchObject({
      status: 'READY',
      checks: {
        appliedMigrations: 38,
        expectedMigrations: 37,
        migrationIdentityStatus: 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED',
        forwardCompatibleMigrationCount: 1,
      },
    });
  });

  it('fails readiness when a critical runtime flag is enabled', async () => {
    const release = {
      getEnvironment: jest.fn().mockReturnValue('staging'),
      getSchemaMigrationCount: jest.fn().mockReturnValue(30),
      getMigrationInventory: jest.fn().mockReturnValue(inventory),
      getMigrationAttestations: jest.fn().mockReturnValue([]),
      getRequiredSafetyFlags: jest.fn().mockReturnValue(safetyFlags),
    } as unknown as ReleaseMetadataService;
    const unsafeConfig = {
      get: jest.fn((key: string) => key === 'SOFIA_AUTO_SAFE_ENABLED'),
    } as unknown as ConfigService;
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)) } as unknown as PrismaService;

    await expect(
      new HealthService(prisma, observability, release, unsafeConfig).readiness(),
    ).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports intentionally disabled providers without claiming they are healthy', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)) } as unknown as PrismaService;
    const disabledConfig = {
      get: jest.fn((key: string) => ({
        WHATSAPP_MODE: 'disabled',
        SOFIA_AI_MODE: 'disabled',
        WHATSAPP_QR_ALLOW_REAL_SEND: false,
        SOFIA_PRODUCTION_ENABLED: false,
        PHASE5_ORDER_CREATION_ENABLED: false,
      })[key]),
    } as unknown as ConfigService;

    await expect(
      new HealthService(
        prisma,
        observability,
        releaseMetadata,
        disabledConfig,
      ).readiness(),
    ).resolves.toMatchObject({
      status: 'READY',
      services: {
        providers: {
          whatsappInbound: 'DISABLED_BY_POLICY',
          whatsappOutbound: 'DISABLED_BY_POLICY',
          aiGeneration: 'DISABLED_BY_POLICY',
          boldMutation: 'DISABLED_BY_POLICY',
        },
      },
    });
  });

  it('coalesces and caches concurrent readiness checks', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(appliedRows(inventory)) } as unknown as PrismaService;
    const service = new HealthService(prisma, observability, releaseMetadata, config);

    await Promise.all(Array.from({ length: 20 }, () => service.readiness()));
    await service.readiness();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

function appliedRows(inventory: Array<{ name: string; checksum: string }>) {
  return inventory.map(({ name: migrationName, checksum }) => ({
    migrationName,
    checksum,
    finished: true,
    rolledBack: false,
  }));
}

function repositoryInventory() {
  const root = path.resolve(process.cwd(), '../../prisma/migrations');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      // Test inventory is constrained to the repository migration directory above.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      checksum: createHash('sha256').update(readFileSync(path.join(root, name, 'migration.sql'))).digest('hex'),
    }));
}
