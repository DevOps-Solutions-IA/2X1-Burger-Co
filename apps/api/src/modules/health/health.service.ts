import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';
import { ReleaseMetadataService } from '../../release/release-metadata.service';
import { evaluateMigrationIdentity, type AppliedMigration } from './migration-identity';

const READINESS_CACHE_MS = 5_000;

@Injectable()
export class HealthService {
  private readinessCache: { expiresAt: number; result: Record<string, unknown> } | null = null;
  private readinessInFlight: Promise<Record<string, unknown>> | null = null;

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
    const now = Date.now();
    if (this.readinessCache && this.readinessCache.expiresAt > now) {
      return this.readinessCache.result;
    }
    if (this.readinessInFlight) return this.readinessInFlight;

    this.readinessInFlight = this.evaluateReadiness()
      .then((result) => {
        this.readinessCache = { expiresAt: Date.now() + READINESS_CACHE_MS, result };
        return result;
      })
      .finally(() => {
        this.readinessInFlight = null;
      });
    return this.readinessInFlight;
  }

  private async evaluateReadiness(): Promise<Record<string, unknown>> {
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
      (!releaseRequiresExpectation || (expected !== null && expectedInventory.length > 0));
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

    const providers = this.providerActivationState();

    return {
      status: 'READY',
      timestamp: new Date().toISOString(),
      services: {
        api: 'READY',
        database: 'READY',
        release: 'READY',
        safety: 'READY',
        providers,
      },
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
        forwardCompatibleMigrationCount: migrationIdentity.forwardCompatibleMigrationCount,
        forwardCompatibilityEvidence: migrationIdentity.forwardCompatibilityEvidence,
        safetyCompatible,
      },
    };
  }

  check() {
    const live = this.liveness();
    return {
      ...live,
      status: 'ok',
      environment: this.releaseMetadata.getEnvironment(),
    };
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

  private providerActivationState() {
    const whatsappMode = this.config.get<string>('WHATSAPP_MODE') ?? 'disabled';
    const aiMode = this.config.get<string>('SOFIA_AI_MODE') ?? 'disabled';
    const realSendingEnabled = this.config.get<boolean>('WHATSAPP_QR_ALLOW_REAL_SEND') === true;
    const productionEnabled = this.config.get<boolean>('SOFIA_PRODUCTION_ENABLED') === true;
    const orderCreationEnabled = this.config.get<boolean>('PHASE5_ORDER_CREATION_ENABLED') === true;
    return {
      whatsappInbound: whatsappMode === 'disabled' ? 'DISABLED_BY_POLICY' : 'ENABLED_REQUIRES_PROVIDER_PROBE',
      whatsappOutbound: realSendingEnabled ? 'ENABLED_REQUIRES_PROVIDER_PROBE' : 'DISABLED_BY_POLICY',
      aiGeneration: aiMode === 'disabled' ? 'DISABLED_BY_POLICY' : 'ENABLED_REQUIRES_PROVIDER_PROBE',
      boldMutation: productionEnabled && orderCreationEnabled ? 'ENABLED_REQUIRES_PROVIDER_PROBE' : 'DISABLED_BY_POLICY',
      orderExecution: orderCreationEnabled ? 'ENABLED_REQUIRES_RUNTIME_PROBE' : 'DISABLED_BY_POLICY',
    } as const;
  }
}
