import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observability: ObservabilityService,
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
    try {
      const migrations = await this.prisma.$queryRaw<Array<{ applied: bigint; failed: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS applied,
          COUNT(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)::bigint AS failed
        FROM "_prisma_migrations"
      `;
      const applied = Number(migrations[0]?.applied ?? 0);
      const failed = Number(migrations[0]?.failed ?? 0);
      const expected = Number(process.env.EXPECTED_MIGRATION_COUNT ?? 0);
      const migrationCompatible = failed === 0 && applied > 0 && (expected === 0 || applied === expected);
      if (!migrationCompatible) throw new Error('MIGRATION_INCOMPATIBLE');
      return {
        status: 'READY',
        timestamp: new Date().toISOString(),
        services: { api: 'READY', database: 'READY' },
        checks: {
          databaseLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
          appliedMigrations: applied,
          expectedMigrations: expected || null,
          migrationCompatible,
        },
      };
    } catch (error) {
      this.observability.recordReadinessFailure();
      const reason = error instanceof Error && error.message === 'MIGRATION_INCOMPATIBLE' ? 'MIGRATION_INCOMPATIBLE' : 'DATABASE_UNAVAILABLE';
      throw new ServiceUnavailableException({
        status: 'UNHEALTHY',
        timestamp: new Date().toISOString(),
        services: { api: 'ALIVE', database: 'UNAVAILABLE' },
        reason,
      });
    }
  }

  async check() {
    const ready = await this.readiness();
    return { ...ready, status: 'ok', environment: process.env.NODE_ENV ?? 'development' };
  }

  metrics() {
    return this.observability.snapshot();
  }

  observabilitySnapshot() {
    return this.observability.snapshot({ includeBusiness: true });
  }
}
