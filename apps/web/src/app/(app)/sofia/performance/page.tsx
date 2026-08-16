'use client';

import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PackageSearch, ShieldAlert, Tags } from 'lucide-react';
import { ControlTowerFrame, PageHeader, QueryStateBoundary } from '@/components/sofia';
import { useSofiaMetricsSummary } from '@/features/sofia/queries';
import type { SofiaMetricsRange } from '@/features/sofia/contracts';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS: { value: SofiaMetricsRange; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

const AUTO_SAFE_COLORS: Record<'approved' | 'humanRequired' | 'blocked' | 'draftOnly', string> = {
  approved: '#10b981', // emerald-500
  humanRequired: '#f59e0b', // amber-500
  blocked: '#ef4444', // red-500
  draftOnly: '#a8a29e', // stone-400
};

const AUTO_SAFE_LABELS: Record<keyof typeof AUTO_SAFE_COLORS, string> = {
  approved: 'Aprobado (autónomo)',
  humanRequired: 'Requiere humano',
  blocked: 'Bloqueado por SafetyGuard',
  draftOnly: 'Solo borrador',
};

function percent(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

function RangeSelector({ range, onChange }: { range: SofiaMetricsRange; onChange: (r: SofiaMetricsRange) => void }) {
  return (
    <div className="flex gap-1.5 rounded-full border border-stone-200 bg-white p-1" data-testid="sofia-performance-range-selector">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={range === option.value}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
            range === option.value ? 'bg-brand-500 text-ink shadow-soft' : 'text-stone-600 hover:bg-stone-100 hover:text-ink',
          )}
          data-testid={`sofia-performance-range-${option.value}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FunnelBar({ label, value, max, testId }: { label: string; value: number; max: number; testId: string }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
  return (
    <div className="flex items-center gap-3" data-testid={testId}>
      <p className="w-32 shrink-0 truncate text-[12px] font-semibold text-stone-600">{label}</p>
      <div className="h-6 flex-1 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${width}%` }} />
      </div>
      <p className="numeric-tabular w-14 shrink-0 text-right text-[13px] font-bold text-ink [font-variant-numeric:tabular-nums]">
        {formatNumber(value)}
      </p>
    </div>
  );
}

export default function SofiaPerformancePage() {
  const [range, setRange] = useState<SofiaMetricsRange>('today');
  const metrics = useSofiaMetricsSummary(range);

  const autoSafeChartData = useMemo(() => {
    if (!metrics.data) return [];
    const { approved, humanRequired, blocked, draftOnly } = metrics.data.autoSafe;
    return (Object.entries({ approved, humanRequired, blocked, draftOnly }) as [keyof typeof AUTO_SAFE_COLORS, number][])
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, name: AUTO_SAFE_LABELS[key], value: count, color: AUTO_SAFE_COLORS[key] }));
  }, [metrics.data]);

  return (
    <ControlTowerFrame>
      <div className="space-y-4" data-testid="sofia-performance-page">
        <PageHeader
          eyebrow="Torre de Control"
          title="Rendimiento"
          description="Comportamiento real de SOFIA: qué tan seguido actúa sola con éxito, cuándo escala a un humano, cuándo SafetyGuard bloquea una acción y qué tan preciso es el reconocimiento del catálogo."
          actions={<RangeSelector range={range} onChange={setRange} />}
          data-testid="sofia-performance-header"
        />

        <QueryStateBoundary
          isLoading={metrics.isLoading}
          isError={metrics.isError}
          error={metrics.error}
          data={metrics.data}
          loadingLabel="Cargando métricas de rendimiento…"
          errorTitle="No se pudo cargar el rendimiento de SOFIA"
          data-testid="sofia-performance-metrics"
        >
          {(data) => (
            <div className="space-y-4">
              {/* Tasa de éxito auto-safe */}
              <Card data-testid="sofia-performance-autosafe-card">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Tasa de éxito auto-safe</p>
                <h2 className="mt-1 text-[1.05rem] font-bold text-ink">
                  {data.autoSafe.total > 0
                    ? `${percent(data.autoSafe.approved, data.autoSafe.total)} aprobado sin intervención`
                    : 'Sin datos en este rango'}
                </h2>
                {data.autoSafe.total === 0 ? (
                  <EmptyState
                    className="mt-3"
                    title="Sin actividad auto-safe"
                    description="SOFIA no registró intentos de auto-safe en el rango seleccionado."
                    icon={<ShieldAlert className="h-5 w-5" />}
                  />
                ) : (
                  <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="h-56 w-full lg:w-64" data-testid="sofia-performance-autosafe-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={autoSafeChartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                            {autoSafeChartData.map((entry) => (
                              <Cell key={entry.key} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [
                              `${formatNumber(Number(value ?? 0))} (${percent(Number(value ?? 0), data.autoSafe.total)})`,
                              String(name),
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="flex-1 space-y-2" data-testid="sofia-performance-autosafe-legend">
                      {(Object.keys(AUTO_SAFE_COLORS) as (keyof typeof AUTO_SAFE_COLORS)[]).map((key) => {
                        const value = data.autoSafe[key];
                        return (
                          <li key={key} className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2">
                            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-stone-700">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: AUTO_SAFE_COLORS[key] }} aria-hidden="true" />
                              {AUTO_SAFE_LABELS[key]}
                            </span>
                            <span className="numeric-tabular text-[12.5px] font-bold text-ink [font-variant-numeric:tabular-nums]">
                              {formatNumber(value)} · {percent(value, data.autoSafe.total)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Card>

              {/* Embudo de conversaciones */}
              <Card data-testid="sofia-performance-funnel-card">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Embudo de conversaciones</p>
                {data.conversations.total === 0 ? (
                  <EmptyState
                    className="mt-3"
                    title="Sin conversaciones en este rango"
                    description="No se registraron conversaciones en el rango seleccionado."
                  />
                ) : (
                  <div className="mt-3 space-y-2.5">
                    <FunnelBar label="Total" value={data.conversations.total} max={data.conversations.total} testId="sofia-performance-funnel-total" />
                    <FunnelBar label="Activas" value={data.conversations.active} max={data.conversations.total} testId="sofia-performance-funnel-active" />
                    <FunnelBar
                      label="Requieren humano"
                      value={data.conversations.humanRequired}
                      max={data.conversations.total}
                      testId="sofia-performance-funnel-human-required"
                    />
                    <FunnelBar
                      label="Tomadas por humano"
                      value={data.conversations.humanTaken}
                      max={data.conversations.total}
                      testId="sofia-performance-funnel-human-taken"
                    />
                    <FunnelBar label="Resueltas" value={data.conversations.resolved} max={data.conversations.total} testId="sofia-performance-funnel-resolved" />
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Top razones de bloqueo/escalado */}
                <Card data-testid="sofia-performance-reasons-card">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Top razones de bloqueo/escalado</p>
                  {data.autoSafe.topReasonCodes.length === 0 ? (
                    <EmptyState className="mt-3" title="Sin razones registradas" description="No hay códigos de razón en este rango." />
                  ) : (
                    <ol className="mt-3 space-y-2" data-testid="sofia-performance-reasons-list">
                      {data.autoSafe.topReasonCodes.map((reason, index) => (
                        <li
                          key={reason.key}
                          className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2"
                        >
                          <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-stone-700">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-bold text-stone-600">
                              {index + 1}
                            </span>
                            <span className="truncate">{reason.key}</span>
                          </span>
                          <span className="numeric-tabular shrink-0 text-[12.5px] font-bold text-ink [font-variant-numeric:tabular-nums]">
                            {formatNumber(reason.count)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                {/* Precisión de catálogo */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" data-testid="sofia-performance-catalog-metrics">
                  <MetricCard
                    label="Productos desconocidos"
                    value={formatNumber(data.catalog.unknownProducts)}
                    icon={<PackageSearch className="h-5 w-5" />}
                    accent="warning"
                    compact
                  />
                  <MetricCard
                    label="Precios desconocidos"
                    value={formatNumber(data.catalog.unknownPrices)}
                    icon={<Tags className="h-5 w-5" />}
                    accent="warning"
                    compact
                  />
                  <MetricCard
                    label="Correcciones Maxy Family"
                    value={formatNumber(data.catalog.maxiFamilyCorrections)}
                    icon={<ShieldAlert className="h-5 w-5" />}
                    accent="ink"
                    compact
                  />
                </div>
              </div>

              {/* Funnel inbound/outbound */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card data-testid="sofia-performance-inbound-card">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Inbound</p>
                  <table className="mt-3 w-full text-[12.5px]" data-testid="sofia-performance-inbound-table">
                    <tbody>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Total recibidos</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.inbound.total)}
                        </td>
                      </tr>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Vía QR Gateway</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.inbound.qrGateway)}
                        </td>
                      </tr>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Bloqueados por allowlist</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.inbound.allowlistBlocked)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-stone-600">Duplicados ignorados</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.inbound.duplicatesIgnored)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </Card>
                <Card data-testid="sofia-performance-outbound-card">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Outbound</p>
                  <table className="mt-3 w-full text-[12.5px]" data-testid="sofia-performance-outbound-table">
                    <tbody>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Sugeridos</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.outbound.suggested)}
                        </td>
                      </tr>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Solo borrador</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.outbound.draftOnly)}
                        </td>
                      </tr>
                      <tr className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-600">Pendientes de aprobación</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.outbound.approvalPending)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-stone-600">Enviados reales</td>
                        <td className="numeric-tabular py-1.5 text-right font-bold text-ink [font-variant-numeric:tabular-nums]">
                          {formatNumber(data.outbound.sentReal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          )}
        </QueryStateBoundary>
      </div>
    </ControlTowerFrame>
  );
}
