import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';
import { ReleaseMetadataService } from '../../release/release-metadata.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observability: ObservabilityService,
    private readonly releaseMetadata: ReleaseMetadataService,
    private readonly config: ConfigService,
  ) {}

  liveness() {
    return {
      status: 'ALIVE',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  async readiness() {
    const startedAt = performance.now();
    let migrations: Array<{
      migrationName: string;
      checksum: string;
      finished: boolean;
      rolledBack: boolean;
    }>;
    try {
      migrations = await this.prisma.$queryRaw<Array<{
        migrationName: string;
        checksum: string;
        finished: boolean;
        rolledBack: boolean;
      }>>`
        SELECT
          migration_name AS "migrationName",
          checksum,
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS "rolledBack"
        FROM "_prisma_migrations"
        ORDER BY migration_name ASC
      `;
    } catch {
      this.observability.recordReadinessFailure();
      throw new ServiceUnavailableException({
        status: 'UNHEALTHY',
        timestamp: new Date().toISOString(),
        services: { api: 'ALIVE', database: 'UNAVAILABLE' },
        reason: 'DATABASE_UNAVAILABLE',
      });
    }

    const appliedRows = migrations.filter((migration) => migration.finished && !migration.rolledBack);
    const failed = migrations.filter((migration) => !migration.finished && !migration.rolledBack).length;
    const applied = appliedRows.length;
    const expected = this.releaseMetadata.getSchemaMigrationCount();
    const expectedInventory = this.releaseMetadata.getMigrationInventory();
    const releaseRequiresExpectation = ['staging', 'production'].includes(this.releaseMetadata.getEnvironment());
    const actualByName = new Map(appliedRows.map((migration) => [migration.migrationName, migration.checksum]));
    const expectedByName = new Map(expectedInventory.map((migration) => [migration.name, migration.checksum]));
    const exactMigrationIdentity =
      expectedInventory.length > 0 &&
      expectedInventory.length === appliedRows.length &&
      expectedInventory.every((migration) => actualByName.get(migration.name) === migration.checksum) &&
      appliedRows.every((migration) => expectedByName.has(migration.migrationName));
    const migrationCompatible =
      failed === 0 &&
      applied > 0 &&
      (!releaseRequiresExpectation || (expected !== null && expectedInventory.length > 0)) &&
      (expected === null || applied === expected) &&
      (!releaseRequiresExpectation || exactMigrationIdentity);
    if (!migrationCompatible) {
      this.failReadiness('MIGRATION_INCOMPATIBLE', { api: 'ALIVE', database: 'READY', release: 'NOT_READY' });
    }

    const requiredSafety = this.releaseMetadata.getRequiredSafetyFlags();
    const declaredSafety = {
      realSendingEnabled: this.config.get<boolean>('WHATSAPP_QR_ALLOW_REAL_SEND') === true,
      autoReplyEnabled: this.config.get<boolean>('SOFIA_AUTO_REPLY_ENABLED') === true,
      autoSafeEnabled: this.config.get<boolean>('SOFIA_AUTO_SAFE_ENABLED') === true,
      productionEnabled: this.config.get<boolean>('SOFIA_PRODUCTION_ENABLED') === true,
      whatsappCanMarkPaid: false,
    };
    const safetyCompatible = Object.entries(requiredSafety).every(
      ([key, required]) => declaredSafety[key as keyof typeof declaredSafety] === required,
    );
    if (!safetyCompatible) {
      this.failReadiness('SAFETY_CONFIGURATION_UNSAFE', { api: 'ALIVE', database: 'READY', safety: 'NOT_READY' });
    }

    return {
      status: 'READY',
      timestamp: new Date().toISOString(),
      services: { api: 'READY', database: 'READY', release: 'READY', safety: 'READY' },
      checks: {
        databaseLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
        appliedMigrations: applied,
        expectedMigrations: expected,
        migrationCompatible,
        migrationIdentityVerified: releaseRequiresExpectation ? exactMigrationIdentity : null,
        safetyCompatible,
      },
    };
  }

  async check() {
    const ready = await this.readiness();
    return { ...ready, status: 'ok', environment: this.releaseMetadata.getEnvironment() };
  }

  metrics() {
    return this.observability.snapshot();
  }

  observabilitySnapshot() {
    return this.observability.snapshot({ includeBusiness: true });
  }

  private failReadiness(reason: string, services: Record<string, string>): never {
    this.observability.recordReadinessFailure();
    throw new ServiceUnavailableException({
      status: 'UNHEALTHY',
      timestamp: new Date().toISOString(),
      services,
      reason,
    });
  }
}
