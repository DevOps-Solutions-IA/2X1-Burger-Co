import { Injectable, NotFoundException } from '@nestjs/common';
import { OperationalAlertSeverity, OperationalAlertStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaGovernanceService } from '../governance/sofia-governance.service';
import { SofiaMetricsService } from '../metrics/sofia-metrics.service';

@Injectable()
export class SofiaAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governanceService: SofiaGovernanceService,
    private readonly metricsService: SofiaMetricsService,
  ) {}

  async list() {
    const alerts = await this.prisma.operationalAlert.findMany({
      where: { module: 'sofia' },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      title: alert.title,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
    }));
  }

  async check() {
    const [governance, metrics] = await Promise.all([
      this.governanceService.getEnterpriseStatus(),
      this.metricsService.getSummary('today'),
    ]);
    const candidates: Array<{ type: string; severity: OperationalAlertSeverity; title: string; message: string }> = [];
    if (governance.productionReadiness.status === 'BLOCKED') {
      candidates.push({
        type: 'SOFIA_PRODUCTION_BLOCKED',
        severity: OperationalAlertSeverity.WARNING,
        title: 'Producción Sofía bloqueada',
        message: 'Producción permanece bloqueada hasta rotación externa, QR físico y validaciones reales.',
      });
    }
    if (metrics.outbound.blockedRealSend > 0) {
      candidates.push({
        type: 'SOFIA_REAL_SEND_ATTEMPT_BLOCKED',
        severity: OperationalAlertSeverity.CRITICAL,
        title: 'Intento de envío real bloqueado',
        message: 'Se detectó intento de envío QR real mientras realSendingEnabled=false.',
      });
    }
    if (metrics.payments.paidClaimsBlocked > 0 || metrics.payments.paymentSensitiveMessages > 0) {
      candidates.push({
        type: 'SOFIA_PAID_CLAIM_OR_PAYMENT_SENSITIVE',
        severity: OperationalAlertSeverity.WARNING,
        title: 'Pago sensible requiere revisión',
        message: 'WhatsApp no marca PAID. Revisar conversaciones con pagos manuales o reclamos de pago.',
      });
    }
    if (metrics.catalog.unknownProducts > 0) {
      candidates.push({
        type: 'SOFIA_UNKNOWN_PRODUCTS_SPIKE',
        severity: OperationalAlertSeverity.WARNING,
        title: 'Productos desconocidos consultados',
        message: 'Hay consultas por productos fuera del catálogo canónico. Revisar insights antes de cambiar catálogo.',
      });
    }
    if (!governance.sofia.activePromptVersion) {
      candidates.push({
        type: 'SOFIA_NO_ACTIVE_PROMPT',
        severity: OperationalAlertSeverity.CRITICAL,
        title: 'Prompt maestro no activo',
        message: 'Sofía requiere prompt activo para operar.',
      });
    }

    const created = [];
    for (const candidate of candidates) {
      const existing = await this.prisma.operationalAlert.findFirst({
        where: { module: 'sofia', type: candidate.type, status: OperationalAlertStatus.OPEN },
      });
      if (existing) continue;
      created.push(
        await this.prisma.operationalAlert.create({
          data: {
            ...candidate,
            module: 'sofia',
            status: OperationalAlertStatus.OPEN,
            entityType: 'sofia',
            metadata: { generatedBy: 'SOFIA_LEARNING_METRICS_HARDENING_6' },
          },
        }),
      );
    }
    return { checkedAt: new Date().toISOString(), created: created.length, alerts: await this.list(), externalNotificationsSent: false };
  }

  async ack(id: string, actorId: string) {
    const alert = await this.prisma.operationalAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('No se encontró la alerta Sofía.');
    return this.prisma.operationalAlert.update({
      where: { id },
      data: {
        status: OperationalAlertStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        resolvedById: actorId,
      },
    });
  }
}
