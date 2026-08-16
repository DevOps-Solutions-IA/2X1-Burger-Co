'use client';

import Link from 'next/link';
import { BarChart3, ClipboardCheck, ShieldAlert, ShieldCheck, UserCog, Users } from 'lucide-react';
import {
  ControlTowerFrame,
  PageHeader,
  QueryStateBoundary,
  StatCard,
  StatusBadge,
  SOFIA_STATUS_TONE_LABEL,
  toneFromCheckStatus,
  type SofiaStatusTone,
} from '@/components/sofia';
import { Button } from '@/components/ui/button';
import { useSofiaDashboardSummary, useSofiaMetricsSummary } from '@/features/sofia/queries';
import { formatNumber } from '@/lib/format';

/** El backend declara `productionReadinessStatus` como texto libre; se normaliza a los 3 tonos conocidos de readiness y se degrada a "unknown" ante cualquier otro valor. */
function productionReadinessTone(status: string): SofiaStatusTone {
  if (status === 'PASS' || status === 'WARNING' || status === 'BLOCKED') {
    return toneFromCheckStatus(status);
  }
  return 'unknown';
}

export default function SofiaOverviewPage() {
  const dashboardQuery = useSofiaDashboardSummary();
  const todayMetricsQuery = useSofiaMetricsSummary('today');

  return (
    <div className="space-y-4" data-testid="sofia-overview-page">
      <ControlTowerFrame>
        <QueryStateBoundary
          isLoading={dashboardQuery.isLoading || todayMetricsQuery.isLoading}
          isError={dashboardQuery.isError || todayMetricsQuery.isError}
          error={dashboardQuery.error ?? todayMetricsQuery.error}
          data={
            dashboardQuery.data && todayMetricsQuery.data
              ? { dashboard: dashboardQuery.data, metrics: todayMetricsQuery.data }
              : undefined
          }
          loadingLabel="Cargando resumen de SOFIA..."
          errorTitle="No se pudo cargar el resumen"
          variant="console"
          data-testid="sofia-overview"
        >
          {({ dashboard, metrics }) => {
            const readinessTone = productionReadinessTone(dashboard.security.productionReadinessStatus);
            const autoSafeTotal = metrics.autoSafe.total;
            const approvalRate =
              autoSafeTotal > 0 ? Math.round((metrics.autoSafe.approved / autoSafeTotal) * 100) : null;

            return (
              <>
                <PageHeader
                  eyebrow="Torre de Control"
                  title="Resumen"
                  description="Estado operativo del agente y accesos directos a rendimiento y validación."
                  variant="console"
                  statusBadges={
                    <StatusBadge
                      tone={readinessTone}
                      label={SOFIA_STATUS_TONE_LABEL[readinessTone]}
                      variant="console"
                      live={readinessTone === 'blocked' || readinessTone === 'success'}
                    />
                  }
                  data-testid="sofia-overview-header"
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Aprobación auto-safe hoy"
                    value={approvalRate !== null ? `${approvalRate}%` : 'Sin datos'}
                    hint={
                      autoSafeTotal > 0
                        ? `${formatNumber(metrics.autoSafe.approved)} de ${formatNumber(autoSafeTotal)} acciones evaluadas`
                        : 'Sin datos en este rango'
                    }
                    icon={<ShieldCheck className="h-4.5 w-4.5" />}
                    accent="success"
                    variant="console"
                    data-testid="sofia-overview-stat-approval"
                  />
                  <StatCard
                    label="Conversaciones activas"
                    value={formatNumber(metrics.conversations.active)}
                    hint={`${formatNumber(metrics.conversations.total)} conversaciones hoy`}
                    icon={<Users className="h-4.5 w-4.5" />}
                    accent="brand"
                    variant="console"
                    data-testid="sofia-overview-stat-active"
                  />
                  <StatCard
                    label="Requieren humano"
                    value={formatNumber(metrics.conversations.humanRequired)}
                    hint={`${formatNumber(metrics.conversations.humanTaken)} ya tomadas por un humano`}
                    icon={<UserCog className="h-4.5 w-4.5" />}
                    accent="warning"
                    variant="console"
                    data-testid="sofia-overview-stat-human"
                  />
                  <StatCard
                    label="Seguridad y producción"
                    value={SOFIA_STATUS_TONE_LABEL[readinessTone]}
                    hint={`${formatNumber(dashboard.security.blockedChecks.length)} bloqueos · ${formatNumber(dashboard.security.pendingChecks.length)} pendientes`}
                    icon={
                      readinessTone === 'success' ? (
                        <ShieldCheck className="h-4.5 w-4.5" />
                      ) : (
                        <ShieldAlert className="h-4.5 w-4.5" />
                      )
                    }
                    accent={readinessTone === 'success' ? 'success' : readinessTone === 'blocked' ? 'danger' : 'warning'}
                    variant="console"
                    data-testid="sofia-overview-stat-security"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2" data-testid="sofia-overview-quick-links">
                  <Button asChild>
                    <Link href="/sofia/performance">
                      <BarChart3 className="h-4 w-4" aria-hidden="true" />
                      Ver rendimiento
                    </Link>
                  </Button>
                  <Button asChild variant="secondary" className="bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]">
                    <Link href="/sofia/validation">
                      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      Ir a validación
                    </Link>
                  </Button>
                </div>
              </>
            );
          }}
        </QueryStateBoundary>
      </ControlTowerFrame>
    </div>
  );
}
