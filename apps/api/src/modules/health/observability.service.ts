import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../../prisma/prisma.service';

type HttpObservation = {
  durationMs: number;
  statusCode: number;
};

type RecoveryStatus = {
  status?: string;
  createdAt?: string;
  checksumVerified?: boolean;
  restoreVerified?: boolean;
};

const MAX_LATENCY_SAMPLES = 2048;

@Injectable()
export class ObservabilityService {
  private readonly startedAt = Date.now();
  private readonly latencies: number[] = [];
  private httpRequests = 0;
  private httpErrors = 0;
  private readinessFailures = 0;

  constructor(private readonly prisma: PrismaService) {}

  recordHttp(observation: HttpObservation) {
    this.httpRequests += 1;
    if (observation.statusCode >= 500) this.httpErrors += 1;
    this.latencies.push(observation.durationMs);
    if (this.latencies.length > MAX_LATENCY_SAMPLES) this.latencies.shift();
  }

  recordReadinessFailure() {
    this.readinessFailures += 1;
  }

  async snapshot(options: { includeBusiness?: boolean } = {}) {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const latency = this.latencySummary();
    const database = await this.databaseSnapshot(options.includeBusiness === true);
    const recovery = this.recoveryStatus();
    const effectiveFlags = {
      realSendingEnabled: this.strictTrue(process.env.WHATSAPP_QR_ALLOW_REAL_SEND),
      autoReplyEnabled: this.strictTrue(process.env.SOFIA_AUTO_REPLY_ENABLED),
      autoSafeEnabled: this.strictTrue(process.env.SOFIA_AUTO_SAFE_ENABLED),
      productionEnabled: this.strictTrue(process.env.SOFIA_PRODUCTION_ENABLED),
    };

    const metrics = {
      generatedAt: new Date().toISOString(),
      system: {
        processUptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        eventLoopUtilization: performance.eventLoopUtilization().utilization,
        activeResources: process.getActiveResourcesInfo().length,
      },
      http: {
        requestsTotal: this.httpRequests,
        errorsTotal: this.httpErrors,
        errorRate: this.httpRequests === 0 ? 0 : this.httpErrors / this.httpRequests,
        latencyMs: latency,
        readinessFailuresTotal: this.readinessFailures,
      },
      database,
      business: database.business,
      sofiaWhatsapp: database.sofiaWhatsapp,
      recovery,
      tracing: {
        propagation: 'W3C_TRACE_CONTEXT_COMPATIBLE',
        exporter: 'LOCAL_STRUCTURED_LOG',
        externalExport: false,
      },
      effectiveFlags,
    };

    return {
      status: database.available ? 'READY' : 'DEGRADED',
      metrics,
      alerts: this.evaluateAlerts(metrics),
      cardinalityPolicy: 'NO_PHONE_ORDER_USER_OR_REQUEST_LABELS',
    };
  }

  private latencySummary(): { samples: number; p50: number | null; p95: number | null; p99: number | null } {
    if (this.latencies.length === 0) return { samples: 0, p50: null, p95: null, p99: null };
    const values = [...this.latencies].sort((left, right) => left - right);
    const percentile = (ratio: number) => values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] ?? null;
    return {
      samples: values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    };
  }

  private async databaseSnapshot(includeBusiness: boolean) {
    try {
      const startedAt = performance.now();
      if (!includeBusiness) {
        const connections = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()
        `;
        return {
          available: true,
          queryDurationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          connections: Number(connections[0]?.count ?? 0),
          business: null,
          sofiaWhatsapp: null,
        };
      }
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const [connections, sales, orders, cashOpen, cashClosed, deliveries, inventoryMovements, paymentSensitive, messagesReceived, messagesBlocked, duplicateEvents, humanEscalations, sendAttempts, sendBlocked, autoReplyAttempts, autoSafeAttempts, timeouts, allowlistDenied] =
        await Promise.all([
          this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`,
          this.prisma.sale.count(),
          this.prisma.orderTicket.count(),
          this.prisma.cashSession.count({ where: { status: 'OPEN' } }),
          this.prisma.cashSession.count({ where: { status: 'CLOSED' } }),
          this.prisma.orderTicket.count({ where: { type: 'DELIVERY' } }),
          this.prisma.inventoryMovement.count(),
          this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { reasonCodesJson: { array_contains: ['PAYMENT_SENSITIVE'] }, createdAt: { gte: since } } }),
          this.prisma.whatsappInboundEvent.count({ where: { receivedAt: { gte: since } } }),
          this.prisma.auditLog.count({ where: { module: 'SofiaRuntimeSafety', createdAt: { gte: since } } }),
          this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'DUPLICATE_IGNORED', receivedAt: { gte: since } } }),
          this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_REQUIRED', updatedAt: { gte: since } } }),
          this.prisma.whatsappOutboundMessage.count({ where: { attempts: { gt: 0 }, createdAt: { gte: since } } }),
          this.prisma.auditLog.count({ where: { action: 'SOFIA_RUNTIME_OUTBOUND_SEND_BLOCKED', createdAt: { gte: since } } }),
          this.prisma.auditLog.count({ where: { action: 'SOFIA_RUNTIME_AUTO_REPLY_BLOCKED', createdAt: { gte: since } } }),
          this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { createdAt: { gte: since } } }),
          this.prisma.auditLog.count({ where: { action: { contains: 'TIMEOUT' }, createdAt: { gte: since } } }),
          this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'ALLOWLIST_REQUIRED', receivedAt: { gte: since } } }),
        ]);
      return {
        available: true,
        queryDurationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        connections: Number(connections[0]?.count ?? 0),
        business: {
          salesCreatedTotal: sales,
          ordersCreatedTotal: orders,
          cashOpenTotal: cashOpen,
          cashCloseTotal: cashClosed,
          deliveryCreatedTotal: deliveries,
          inventoryMovementsTotal: inventoryMovements,
          paymentSensitiveTotal: paymentSensitive,
        },
        sofiaWhatsapp: {
          messagesReceivedTotal: messagesReceived,
          messagesBlockedTotal: messagesBlocked,
          duplicateEventsTotal: duplicateEvents,
          humanEscalationsTotal: humanEscalations,
          sendAttemptsTotal: sendAttempts,
          sendBlockedTotal: sendBlocked,
          autoReplyAttemptsTotal: autoReplyAttempts,
          autoSafeAttemptsTotal: autoSafeAttempts,
          timeoutTotal: timeouts,
          allowlistDeniedTotal: allowlistDenied,
        },
      };
    } catch {
      return {
        available: false,
        queryDurationMs: null,
        connections: null,
        business: null,
        sofiaWhatsapp: null,
      };
    }
  }

  private recoveryStatus(): RecoveryStatus & { configured: boolean } {
    const statusPath = process.env.RECOVERY_STATUS_PATH;
    if (!statusPath) return { configured: false, status: 'NOT_CONFIGURED' };
    try {
      const raw = JSON.parse(readFileSync(statusPath, 'utf8')) as RecoveryStatus;
      return {
        configured: true,
        status: raw.status ?? 'UNKNOWN',
        createdAt: raw.createdAt,
        checksumVerified: raw.checksumVerified === true,
        restoreVerified: raw.restoreVerified === true,
      };
    } catch {
      return { configured: true, status: 'UNREADABLE' };
    }
  }

  private evaluateAlerts(metrics: {
    system: { rssBytes: number };
    http: { errorRate: number; latencyMs: { p95: number | null } };
    database: { available: boolean; connections: number | null };
    recovery: RecoveryStatus & { configured: boolean };
    effectiveFlags: {
      realSendingEnabled: boolean;
      autoReplyEnabled: boolean;
      autoSafeEnabled: boolean;
      productionEnabled: boolean;
    };
  }) {
    const alerts = [
      this.alert('API_HIGH_ERROR_RATE', 'HIGH', metrics.http.errorRate >= 0.05, 'http.errorRate >= 0.05'),
      this.alert('API_HIGH_P95', 'MEDIUM', (metrics.http.latencyMs.p95 ?? 0) >= 1000, 'http.latency.p95 >= 1000ms'),
      this.alert('DB_UNAVAILABLE', 'CRITICAL', !metrics.database.available, 'database.available == false'),
      this.alert('DB_POOL_PRESSURE', 'HIGH', (metrics.database.connections ?? 0) >= 80, 'database.connections >= 80'),
      this.alert('PROCESS_MEMORY_HIGH', 'HIGH', metrics.system.rssBytes >= 1_073_741_824, 'process.rss >= 1GiB'),
      this.alert('BACKUP_STATUS_INVALID', 'HIGH', metrics.recovery.configured && metrics.recovery.status !== 'PASS', 'recovery.status != PASS'),
      this.alert('REAL_SEND_UNEXPECTED', 'CRITICAL', metrics.effectiveFlags.realSendingEnabled, 'realSendingEnabled == true'),
      this.alert('AUTO_SAFE_UNEXPECTED', 'CRITICAL', metrics.effectiveFlags.autoSafeEnabled, 'autoSafeEnabled == true'),
      this.alert('PRODUCTION_UNEXPECTED', 'CRITICAL', metrics.effectiveFlags.productionEnabled, 'productionEnabled == true'),
    ];
    return alerts.filter((alert) => alert.active);
  }

  private alert(code: string, severity: string, active: boolean, condition: string) {
    const runbooks: Record<string, string> = {
      API_HIGH_ERROR_RATE: 'high-error-rate.md',
      API_HIGH_P95: 'high-latency.md',
      DB_UNAVAILABLE: 'database-down.md',
      DB_POOL_PRESSURE: 'database-down.md',
      PROCESS_MEMORY_HIGH: 'high-latency.md',
      BACKUP_STATUS_INVALID: 'backup-failure.md',
      REAL_SEND_UNEXPECTED: 'sofia-unsafe-flag.md',
      AUTO_SAFE_UNEXPECTED: 'sofia-unsafe-flag.md',
      PRODUCTION_UNEXPECTED: 'sofia-unsafe-flag.md',
    };
    return {
      code,
      severity,
      active,
      condition,
      notificationChannel: 'OWNER_GATE_NOT_CONFIGURED',
      runbook: `/docs/runbooks/${runbooks[code] ?? 'README.md'}`,
    };
  }

  private strictTrue(value: string | undefined) {
    return value?.trim().toLowerCase() === 'true' || value?.trim() === '1';
  }
}
