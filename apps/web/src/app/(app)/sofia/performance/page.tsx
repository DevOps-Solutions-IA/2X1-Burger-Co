'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CircleDollarSign, PackageSearch, Sparkles } from 'lucide-react';
import {
  ControlTowerFrame,
  PageHeader,
  QueryStateBoundary,
  StatCard,
  SOFIA_CHART_COLORS,
  SOFIA_CHART_TOOLTIP_STYLE,
} from '@/components/sofia';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useSofiaMetricsSummary } from '@/features/sofia/queries';
import type { SofiaMetricsRange, SofiaMetricsSummary } from '@/features/sofia/contracts';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS: { value: SofiaMetricsRange; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * Selector de rango compartido por los 3 bloques de esta página — un único
 * fetch por rango vía `useSofiaMetricsSummary`. Nunca combina `transition-colors`
 * con `hover:text-*`: el hover solo cambia fondo, el color de texto queda fijo.
 */
function RangeSelector({
  value,
  onChange,
}: {
  value: SofiaMetricsRange;
  onChange: (range: SofiaMetricsRange) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-stone-200 bg-white p-1"
      role="tablist"
      aria-label="Rango de tiempo"
      data-testid="sofia-performance-range"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 rounded-full px-3.5 text-[12px] font-semibold text-stone-600 transition-[background-color,box-shadow]',
              active ? 'bg-brand-500 text-ink shadow-soft' : 'bg-transparent hover:bg-stone-100',
            )}
            data-testid={`sofia-performance-range-${option.value}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type AutoSafeOutcomeKey = 'approved' | 'humanRequired' | 'blocked' | 'draftOnly';

const AUTO_SAFE_SEGMENTS: { key: AutoSafeOutcomeKey; label: string; color: string }[] = [
  { key: 'approved', label: 'Aprobado automáticamente', color: SOFIA_CHART_COLORS.success },
  { key: 'humanRequired', label: 'Escalado a humano', color: SOFIA_CHART_COLORS.warning },
  { key: 'blocked', label: 'Bloqueado por SafetyGuard', color: SOFIA_CHART_COLORS.blocked },
  { key: 'draftOnly', label: 'Solo borrador', color: SOFIA_CHART_COLORS.neutral },
];

/**
 * `autoSafe` ES la tasa de éxito: `approved` actuó sola correctamente,
 * `humanRequired` escaló (no es fallo), `blocked` lo detuvo SafetyGuard,
 * `draftOnly` se quedó en borrador. Dona con centro = tasa de aprobación
 * + leyenda con número y porcentaje explícitos (nunca solo color).
 */
function AutoSafeOutcomeChart({ autoSafe }: { autoSafe: SofiaMetricsSummary['autoSafe'] }) {
  if (autoSafe.total === 0) {
    return (
      <EmptyState
        title="Sin datos en este rango"
        description="No se registraron acciones auto-safe en el rango seleccionado."
      />
    );
  }

  const data = AUTO_SAFE_SEGMENTS.map((segment) => ({ ...segment, value: autoSafe[segment.key] })).filter(
    (segment) => segment.value > 0,
  );

  return (
    <div className="grid grid-cols-1 items-center gap-5 md:grid-cols-[13rem_1fr]">
      <div className="relative mx-auto h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((segment) => (
                <Cell key={segment.key} fill={segment.color} />
              ))}
            </Pie>
            <Tooltip
              {...SOFIA_CHART_TOOLTIP_STYLE}
              formatter={(value, _name, item) => {
                const numericValue = Number(value ?? 0);
                return [
                  `${formatNumber(numericValue)} · ${formatPercent(numericValue, autoSafe.total)}`,
                  (item?.payload as { label?: string } | undefined)?.label ?? '',
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="numeric-tabular text-[1.6rem] font-bold leading-none tracking-tight text-ink [font-variant-numeric:tabular-nums]">
            {formatPercent(autoSafe.approved, autoSafe.total)}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500">Aprobación</p>
        </div>
      </div>

      <ul className="space-y-2" data-testid="sofia-performance-autosafe-legend">
        {data.map((segment) => (
          <li
            key={segment.key}
            className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
                aria-hidden="true"
              />
              <span className="break-words text-[12.5px] font-medium text-ink">{segment.label}</span>
            </span>
            <span className="numeric-tabular shrink-0 text-[12.5px] font-semibold text-ink [font-variant-numeric:tabular-nums]">
              {formatNumber(segment.value)} · {formatPercent(segment.value, autoSafe.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FunnelStageKey = 'total' | 'active' | 'humanRequired' | 'humanTaken' | 'resolved';

const FUNNEL_STAGES: { key: FunnelStageKey; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'active', label: 'Activas' },
  { key: 'humanRequired', label: 'Requieren humano' },
  { key: 'humanTaken', label: 'Tomadas por humano' },
  { key: 'resolved', label: 'Resueltas' },
];

/** Embudo real: cada barra crece desde una línea base común, ancho proporcional al total. */
function ConversationFunnel({ conversations }: { conversations: SofiaMetricsSummary['conversations'] }) {
  const total = conversations.total;

  if (total === 0) {
    return (
      <EmptyState
        title="Sin datos en este rango"
        description="No se registraron conversaciones en el rango seleccionado."
      />
    );
  }

  return (
    <div className="space-y-2.5" data-testid="sofia-performance-funnel">
      {FUNNEL_STAGES.map((stage) => {
        const value = conversations[stage.key];
        const widthPct = (value / total) * 100;
        return (
          <div key={stage.key} className="flex items-center gap-3">
            <span className="w-[9.5rem] shrink-0 text-[12px] font-medium text-stone-600">{stage.label}</span>
            <div className="h-6 min-w-0 flex-1 rounded-md bg-stone-100">
              <div
                className="h-6 rounded-r-md bg-brand-500"
                style={{ width: value > 0 ? `max(${widthPct}%, 6px)` : '0px' }}
              />
            </div>
            <span className="numeric-tabular w-[6.5rem] shrink-0 text-right text-[12.5px] font-semibold text-ink [font-variant-numeric:tabular-nums]">
              {formatNumber(value)} · {formatPercent(value, total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Ranking de razones ya ordenado por el backend — barra proporcional al máximo del propio ranking. */
function TopReasonsChart({ reasons }: { reasons: SofiaMetricsSummary['autoSafe']['topReasonCodes'] }) {
  if (reasons.length === 0) {
    return (
      <EmptyState
        title="Sin datos en este rango"
        description="No se registraron razones de bloqueo o escalado en el rango seleccionado."
      />
    );
  }

  const total = reasons.reduce((sum, reason) => sum + reason.count, 0);
  const max = Math.max(...reasons.map((reason) => reason.count));

  return (
    <ul className="space-y-3" data-testid="sofia-performance-top-reasons">
      {reasons.map((reason, index) => {
        const widthPct = max > 0 ? (reason.count / max) * 100 : 0;
        return (
          <li key={reason.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-[12.5px] font-medium leading-snug text-ink">
                <span className="numeric-tabular mr-1.5 text-stone-400">{index + 1}.</span>
                {reason.key}
              </span>
              <span className="numeric-tabular shrink-0 text-[12px] font-semibold text-stone-600 [font-variant-numeric:tabular-nums]">
                {formatNumber(reason.count)} · {formatPercent(reason.count, total)}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-stone-100">
              <div
                className="h-2 rounded-full"
                style={{ width: reason.count > 0 ? `max(${widthPct}%, 3%)` : '0%', backgroundColor: SOFIA_CHART_COLORS.brand }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const INBOUND_ROWS: { key: keyof SofiaMetricsSummary['inbound']; label: string }[] = [
  { key: 'total', label: 'Total entrantes' },
  { key: 'qrGateway', label: 'Vía WhatsApp QR' },
  { key: 'simulated', label: 'Simulados' },
  { key: 'allowlistBlocked', label: 'Bloqueados por lista blanca' },
  { key: 'duplicatesIgnored', label: 'Duplicados ignorados' },
  { key: 'mediaWithoutTranscript', label: 'Multimedia sin transcripción' },
];

const OUTBOUND_ROWS: { key: keyof SofiaMetricsSummary['outbound']; label: string }[] = [
  { key: 'suggested', label: 'Sugeridos por IA' },
  { key: 'draftOnly', label: 'Solo borrador' },
  { key: 'approvalPending', label: 'Pendientes de aprobación' },
  { key: 'blockedRealSend', label: 'Envío real bloqueado' },
  { key: 'sentReal', label: 'Enviados reales' },
];

function CompactMetricsTable({
  title,
  rows,
  data,
  testId,
}: {
  title: string;
  rows: { key: string; label: string }[];
  data: Record<string, number>;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-stone-500">{title}</h3>
      <table className="mt-2 w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-stone-100 last:border-0">
              <td className="py-1.5 pr-3 text-[12.5px] leading-snug text-stone-600">{row.label}</td>
              <td className="numeric-tabular py-1.5 text-right text-[13px] font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {formatNumber(data[row.key])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SofiaPerformancePage() {
  const [range, setRange] = useState<SofiaMetricsRange>('today');
  const metricsQuery = useSofiaMetricsSummary(range);

  return (
    <div className="space-y-4" data-testid="sofia-performance-page">
      <ControlTowerFrame>
        <PageHeader
          eyebrow="Torre de Control"
          title="Rendimiento"
          description="Comportamiento y tasa de éxito real de SOFIA en el rango seleccionado."
          actions={<RangeSelector value={range} onChange={setRange} />}
          data-testid="sofia-performance-header"
        />

        <QueryStateBoundary
          isLoading={metricsQuery.isLoading}
          isError={metricsQuery.isError}
          error={metricsQuery.error}
          data={metricsQuery.data}
          loadingLabel="Cargando métricas de rendimiento..."
          errorTitle="No se pudieron cargar las métricas"
          data-testid="sofia-performance-metrics"
        >
          {(metrics) => (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <h2 className="text-[13px] font-bold text-ink">Tasa de éxito auto-safe</h2>
                  <div className="mt-3">
                    <AutoSafeOutcomeChart autoSafe={metrics.autoSafe} />
                  </div>
                </Card>
                <Card>
                  <h2 className="text-[13px] font-bold text-ink">Embudo de conversaciones</h2>
                  <div className="mt-4">
                    <ConversationFunnel conversations={metrics.conversations} />
                  </div>
                </Card>
              </div>

              <Card>
                <h2 className="text-[13px] font-bold text-ink">Top razones de bloqueo y escalado</h2>
                <div className="mt-3">
                  <TopReasonsChart reasons={metrics.autoSafe.topReasonCodes} />
                </div>
              </Card>

              <div>
                <h2 className="mb-2 text-[13px] font-bold text-ink">Precisión de catálogo</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Productos desconocidos"
                    value={formatNumber(metrics.catalog.unknownProducts)}
                    icon={<PackageSearch className="h-4.5 w-4.5" />}
                    accent={metrics.catalog.unknownProducts > 0 ? 'warning' : 'success'}
                    data-testid="sofia-performance-stat-unknown-products"
                  />
                  <StatCard
                    label="Precios desconocidos"
                    value={formatNumber(metrics.catalog.unknownPrices)}
                    icon={<CircleDollarSign className="h-4.5 w-4.5" />}
                    accent={metrics.catalog.unknownPrices > 0 ? 'warning' : 'success'}
                    data-testid="sofia-performance-stat-unknown-prices"
                  />
                  <StatCard
                    label="Correcciones Maxi Family"
                    value={formatNumber(metrics.catalog.maxiFamilyCorrections)}
                    icon={<Sparkles className="h-4.5 w-4.5" />}
                    accent="brand"
                    data-testid="sofia-performance-stat-maxi-corrections"
                  />
                </div>
              </div>

              <Card>
                <h2 className="text-[13px] font-bold text-ink">Entrantes y salientes</h2>
                <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <CompactMetricsTable
                    title="Inbound"
                    rows={INBOUND_ROWS}
                    data={metrics.inbound}
                    testId="sofia-performance-inbound-table"
                  />
                  <CompactMetricsTable
                    title="Outbound"
                    rows={OUTBOUND_ROWS}
                    data={metrics.outbound}
                    testId="sofia-performance-outbound-table"
                  />
                </div>
              </Card>
            </div>
          )}
        </QueryStateBoundary>
      </ControlTowerFrame>
    </div>
  );
}
