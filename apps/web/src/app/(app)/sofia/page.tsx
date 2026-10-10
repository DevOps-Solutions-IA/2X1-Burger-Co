'use client';

import Link from 'next/link';
import { Power, ShieldAlert, ShieldCheck, Sparkles, UserCog, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  ControlTowerFrame,
  EmptyStrip,
  PageHeader,
  QueryStateBoundary,
  SectionHeading,
  StatCard,
  StatusBadge,
  SOFIA_STATUS_TONE_LABEL,
  toneFromCheckStatus,
  type SofiaStatusTone,
} from '@/components/sofia';
import { useSofiaDashboardSummary, useSofiaMetricsSummary } from '@/features/sofia/queries';
import { formatNumber } from '@/lib/format';

/** El backend declara `productionReadinessStatus` como texto libre; se normaliza a los 3 tonos conocidos de readiness y se degrada a "unknown" ante cualquier otro valor. */
function productionReadinessTone(status: string): SofiaStatusTone {
  if (status === 'PASS' || status === 'WARNING' || status === 'BLOCKED') {
    return toneFromCheckStatus(status);
  }
  return 'unknown';
}

/**
 * Clase compartida por las 4 `StatCard` de arriba cuando son enlaces reales
 * (en vez de botones sueltos separados) — mismo radio que `Card`, foco
 * visible y una elevación sutil al pasar el mouse para comunicar que son
 * clicables sin depender solo del color.
 */
const LINKED_STAT_CARD_CLASS =
  'block rounded-[1.45rem] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2';

/**
 * Bloque "Estado operativo ahora" — en 10 segundos el owner debe poder
 * confirmar si SOFIA está sana sin entrar a Seguridad. Reutiliza
 * `dashboard.general`/`dashboard.security`, ya cargados por
 * `useSofiaDashboardSummary` en esta misma página (sin query adicional).
 */
function OperationalStatusCard({ dashboard }: { dashboard: { general: { globalPaused: boolean; killSwitchActive: boolean; productionBlocked: boolean }; security: { blockedChecks: string[]; pendingChecks: string[] } } }) {
  const { general, security } = dashboard;
  return (
    <Card data-testid="sofia-overview-operational-status">
      <SectionHeading
        icon={<Power className="h-4.5 w-4.5" />}
        title="Estado operativo ahora"
        subtitle="Gobernanza vigente de SOFIA — ver detalle completo en Seguridad."
        tone="ink"
      />
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5" data-testid="sofia-overview-operational-badges">
        <StatusBadge tone={general.globalPaused ? 'blocked' : 'success'} label={general.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'} />
        <StatusBadge tone={general.killSwitchActive ? 'blocked' : 'success'} label={general.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} />
        <StatusBadge tone={general.productionBlocked ? 'blocked' : 'success'} label={general.productionBlocked ? 'Producción bloqueada' : 'Producción activa'} />
      </div>
      <p className="mt-3 text-[11.5px] text-stone-600">
        {formatNumber(security.blockedChecks.length)} controles bloqueados · {formatNumber(security.pendingChecks.length)} pendientes de rotación/piloto.
      </p>
      <Link
        href="/sofia/safety"
        className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-900 hover:underline"
        data-testid="sofia-overview-link-safety"
      >
        Ver seguridad <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}

/**
 * Bloque "Motivos más frecuentes hoy" — reutiliza el mismo dato que ya
 * trae `useSofiaMetricsSummary('today')` para Rendimiento
 * (`metrics.autoSafe.topReasonCodes`, ranking ya ordenado por el
 * backend), sin duplicar query ni inventar una métrica nueva.
 */
function TopReasonsCard({ reasons }: { reasons: { key: string; count: number }[] }) {
  return (
    <Card data-testid="sofia-overview-top-reasons">
      <SectionHeading icon={<Sparkles className="h-4.5 w-4.5" />} title="Motivos más frecuentes hoy" subtitle="Bloqueo o escalado a humano, auto-safe." tone="ink" />
      {reasons.length === 0 ? (
        <EmptyStrip
          className="mt-3"
          title="Sin datos en este rango"
          description="No se registraron razones de bloqueo o escalado todavía hoy."
        />
      ) : (
        <ol className="mt-3.5 space-y-1.5" data-testid="sofia-overview-top-reasons-list">
          {reasons.slice(0, 3).map((reason, index) => (
            <li
              key={reason.key}
              className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-[12px] font-semibold text-ink"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-bold text-stone-600">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{reason.key}</span>
              <span className="numeric-tabular shrink-0 text-stone-600 [font-variant-numeric:tabular-nums]">{formatNumber(reason.count)}</span>
            </li>
          ))}
        </ol>
      )}
      <Link
        href="/sofia/performance"
        className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-900 hover:underline"
        data-testid="sofia-overview-link-performance-reasons"
      >
        Ver rendimiento completo <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
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
                  description="Estado operativo del agente en un vistazo: salud general, qué requiere atención y acceso directo al detalle."
                  statusBadges={
                    <StatusBadge
                      tone={readinessTone}
                      label={SOFIA_STATUS_TONE_LABEL[readinessTone]}
                      live={readinessTone === 'blocked' || readinessTone === 'success'}
                    />
                  }
                  data-testid="sofia-overview-header"
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-overview-stats">
                  <Link
                    href="/sofia/performance"
                    className={LINKED_STAT_CARD_CLASS}
                    data-testid="sofia-overview-stat-approval-link"
                  >
                    <StatCard
                      label="Aprobación auto-safe hoy"
                      value={approvalRate !== null ? `${approvalRate}%` : 'Sin datos'}
                      hint={
                        autoSafeTotal > 0
                          ? `${formatNumber(metrics.autoSafe.approved)} de ${formatNumber(autoSafeTotal)} acciones · Ver rendimiento →`
                          : 'Sin datos en este rango · Ver rendimiento →'
                      }
                      icon={<ShieldCheck className="h-4.5 w-4.5" />}
                      accent="success"
                      data-testid="sofia-overview-stat-approval"
                    />
                  </Link>
                  <Link
                    href="/sofia/conversations"
                    className={LINKED_STAT_CARD_CLASS}
                    data-testid="sofia-overview-stat-active-link"
                  >
                    <StatCard
                      label="Conversaciones activas"
                      value={formatNumber(metrics.conversations.active)}
                      hint={`${formatNumber(metrics.conversations.total)} conversaciones hoy · Ver bandeja →`}
                      icon={<Users className="h-4.5 w-4.5" />}
                      accent="brand"
                      data-testid="sofia-overview-stat-active"
                    />
                  </Link>
                  <Link
                    href="/sofia/validation"
                    className={LINKED_STAT_CARD_CLASS}
                    data-testid="sofia-overview-stat-human-link"
                  >
                    <StatCard
                      label="Requieren humano"
                      value={formatNumber(metrics.conversations.humanRequired)}
                      hint={`${formatNumber(metrics.conversations.humanTaken)} ya tomadas · Ir a validación →`}
                      icon={<UserCog className="h-4.5 w-4.5" />}
                      accent="warning"
                      data-testid="sofia-overview-stat-human"
                    />
                  </Link>
                  <Link
                    href="/sofia/safety"
                    className={LINKED_STAT_CARD_CLASS}
                    data-testid="sofia-overview-stat-security-link"
                  >
                    <StatCard
                      label="Seguridad y producción"
                      value={SOFIA_STATUS_TONE_LABEL[readinessTone]}
                      hint={`${formatNumber(dashboard.security.blockedChecks.length)} bloqueos · ${formatNumber(dashboard.security.pendingChecks.length)} pendientes · Ver seguridad →`}
                      icon={
                        readinessTone === 'success' ? (
                          <ShieldCheck className="h-4.5 w-4.5" />
                        ) : (
                          <ShieldAlert className="h-4.5 w-4.5" />
                        )
                      }
                      accent={readinessTone === 'success' ? 'success' : readinessTone === 'blocked' ? 'danger' : 'warning'}
                      data-testid="sofia-overview-stat-security"
                    />
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <OperationalStatusCard dashboard={dashboard} />
                  <TopReasonsCard reasons={metrics.autoSafe.topReasonCodes} />
                </div>
              </>
            );
          }}
        </QueryStateBoundary>
      </ControlTowerFrame>
    </div>
  );
}
