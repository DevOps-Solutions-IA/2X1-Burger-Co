import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';
import { ReleaseMetadataService } from '../../release/release-metadata.service';
import { evaluateMigrationIdentity, type AppliedMigration } from './migration-identity';

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
    let migrations: AppliedMigration[];
    try {
      migrations = await this.prisma.$queryRaw<AppliedMigration[]>`
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

    const expected = this.releaseMetadata.getSchemaMigrationCount();
    const expectedInventory = this.releaseMetadata.getMigrationInventory();
    const releaseRequiresExpectation = ['staging', 'production'].includes(this.releaseMetadata.getEnvironment());
    const migrationIdentity = evaluateMigrationIdentity(
      migrations,
      expectedInventory,
      this.releaseMetadata.getMigrationAttestations(),
    );
    const migrationCompatible =
      migrationIdentity.compatible &&
      migrationIdentity.appliedCount > 0 &&
      (!releaseRequiresExpectation || (expected !== null && expectedInventory.length > 0)) &&
      (expected === null || migrationIdentity.appliedCount === expected);
    if (!migrationCompatible) {
      this.failReadiness(migrationIdentity.status, { api: 'ALIVE', database: 'READY', release: 'NOT_READY' });
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
        appliedMigrations: migrationIdentity.appliedCount,
        expectedMigrations: expected,
        migrationCompatible,
        migrationIdentityVerified: releaseRequiresExpectation ? migrationIdentity.compatible : null,
        migrationIdentityExact: releaseRequiresExpectation ? migrationIdentity.exact : null,
        migrationIdentityStatus: migrationIdentity.status,
        migrationAttestationCount: migrationIdentity.attestedMigrationCount,
        migrationAttestationEvidence: migrationIdentity.forensicEvidenceCommits,
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
