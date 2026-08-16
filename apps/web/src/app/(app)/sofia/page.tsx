'use client';

import Link from 'next/link';
import { Activity, ArrowUpRight, ShieldCheck, Users } from 'lucide-react';
import { ControlTowerFrame, PageHeader, QueryStateBoundary, StatusBadge, toneFromCheckStatus } from '@/components/sofia';
import { useSofiaDashboardSummary, useSofiaMetricsSummary } from '@/features/sofia/queries';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';

function formatApprovalRate(approved: number, total: number): string {
  if (total === 0) return 'Sin datos';
  return `${Math.round((approved / total) * 100)}%`;
}

export default function SofiaOverviewPage() {
  const summary = useSofiaDashboardSummary();
  const metricsToday = useSofiaMetricsSummary('today');

  return (
    <ControlTowerFrame>
      <QueryStateBoundary
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        data={summary.data}
        loadingLabel="Cargando resumen de la Torre de Control…"
        errorTitle="No se pudo cargar el resumen"
        data-testid="sofia-overview"
      >
        {(dashboard) => (
          <div className="space-y-4" data-testid="sofia-overview-page">
            <PageHeader
              eyebrow="Torre de Control"
              title="Resumen"
              description="Estado del comportamiento de SOFIA hoy: aprobación automática, conversaciones que requieren atención humana y salud de producción/seguridad. La operación de POS, Caja, Stock y Domicilios permanece intacta."
              statusBadges={
                <>
                  <StatusBadge
                    tone={toneFromCheckStatus(dashboard.security.productionReadinessStatus as 'PASS' | 'WARNING' | 'BLOCKED')}
                    label={`Producción: ${dashboard.security.productionReadinessStatus}`}
                    data-testid="sofia-overview-production-badge"
                  />
                  <StatusBadge tone="read_only" label="Receive-only" />
                  <StatusBadge
                    tone={dashboard.general.globalPaused ? 'blocked' : 'success'}
                    label={dashboard.general.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'}
                  />
                </>
              }
              actions={
                <>
                  <Button variant="secondary" size="sm" asChild>
                    <Link href="/sofia/performance">
                      Ver rendimiento
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="secondary" size="sm" asChild>
                    <Link href="/sofia/validation">
                      Ir a validación
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </>
              }
              data-testid="sofia-overview-header"
            />

            <QueryStateBoundary
              isLoading={metricsToday.isLoading}
              isError={metricsToday.isError}
              error={metricsToday.error}
              data={metricsToday.data}
              loadingLabel="Cargando métricas de hoy…"
              errorTitle="No se pudo cargar las métricas de hoy"
              data-testid="sofia-overview-metrics"
            >
              {(metrics) => (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-overview-kpis">
                  <MetricCard
                    label="Aprobación auto-safe (hoy)"
                    value={formatApprovalRate(metrics.autoSafe.approved, metrics.autoSafe.total)}
                    hint={
                      metrics.autoSafe.total > 0
                        ? `${metrics.autoSafe.approved} de ${metrics.autoSafe.total} acciones aprobadas sin intervención`
                        : 'Sin actividad auto-safe registrada hoy'
                    }
                    icon={<ShieldCheck className="h-5 w-5" />}
                    accent="success"
                  />
                  <MetricCard
                    label="Conversaciones activas"
                    value={String(metrics.conversations.active)}
                    hint={`${metrics.conversations.total} conversaciones totales hoy`}
                    icon={<Activity className="h-5 w-5" />}
                    accent="brand"
                  />
                  <MetricCard
                    label="Requieren humano"
                    value={String(metrics.conversations.humanRequired)}
                    hint={`${metrics.conversations.humanTaken} ya tomadas por un operador`}
                    icon={<Users className="h-5 w-5" />}
                    accent="warning"
                  />
                  <MetricCard
                    label="Estado de seguridad"
                    value={dashboard.security.securityCleanupStatus}
                    hint={`Rotación de secretos: ${dashboard.security.secretRotationStatus}`}
                    icon={<ShieldCheck className="h-5 w-5" />}
                    accent="ink"
                  />
                </div>
              )}
            </QueryStateBoundary>
          </div>
        )}
      </QueryStateBoundary>
    </ControlTowerFrame>
  );
}
