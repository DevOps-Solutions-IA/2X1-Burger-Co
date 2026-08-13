'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Banknote, CircleDollarSign, PackageCheck, ReceiptText, TrendingUp } from 'lucide-react';
import {
  DataTableShell,
  MetricSurface,
  ModuleTabs,
  PageHeader,
  QueryState,
  type DataTableColumn,
} from '@/components/product';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import type { OperationalReport } from './contracts';
import { useDailyReport, useObservabilitySnapshot } from './queries';

type BestSeller = OperationalReport['sales']['bestSellers'][number];
type Breakdown = OperationalReport['sales']['byChannel'][number];

const bestSellerColumns: readonly DataTableColumn<BestSeller>[] = [
  {
    id: 'product',
    header: 'Producto',
    cell: (item) => <span className="font-semibold">{item.productName}</span>,
  },
  {
    id: 'quantity',
    header: 'Unidades',
    numeric: true,
    cell: (item) => formatNumber(item.quantity),
  },
  {
    id: 'total',
    header: 'Venta',
    numeric: true,
    cell: (item) => formatCurrency(item.total),
  },
];

const breakdownColumns: readonly DataTableColumn<Breakdown>[] = [
  {
    id: 'channel',
    header: 'Canal',
    cell: (item) => <span className="font-semibold">{breakdownLabel(item)}</span>,
  },
  {
    id: 'count',
    header: 'Operaciones',
    numeric: true,
    cell: (item) => typeof item.count === 'number' ? formatNumber(item.count) : 'No informado',
  },
  {
    id: 'total',
    header: 'Total',
    numeric: true,
    cell: (item) => item.total == null ? 'No informado' : formatCurrency(item.total),
  },
];

export function AnalyticsScreen() {
  const [date, setDate] = useState(todayInBogota);
  const daily = useDailyReport(date);
  const observability = useObservabilitySnapshot();
  const report = daily.data;
  const averageTicket = report && report.sales.count > 0
    ? numeric(report.sales.total) / report.sales.count
    : null;
  const margin = report && numeric(report.sales.total) !== 0
    ? (numeric(report.metrics.grossProfit) / numeric(report.sales.total)) * 100
    : null;

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Analítica operacional"
        title="Decisiones con evidencia del día"
        description="Lectura financiera y comercial construida sobre reportes canónicos. No se completan periodos faltantes ni se proyectan cifras."
        actions={(
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink">
            <span>Fecha</span>
            <input
              type="date"
              value={date}
              max={todayInBogota()}
              onChange={(event) => setDate(event.target.value)}
              className="min-h-9 rounded-lg border border-line bg-canvas px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Fecha del reporte"
            />
          </label>
        )}
      />

      <ModuleTabs
        label="Navegación de analítica"
        items={[
          { id: 'overview', label: 'Centro operativo', href: '/overview' },
          { id: 'analytics', label: 'Analítica', href: '/analytics', active: true },
          { id: 'reports', label: 'Reportes y cierres', href: '/reports' },
        ]}
      />

      <section aria-labelledby="daily-metrics-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="daily-metrics-title" className="font-heading text-lg font-semibold text-ink">Resultado comercial</h2>
            <p className="mt-1 text-sm text-muted">{report ? `Fuente ${report.metadata.source} · ${formatDateTime(report.metadata.generatedAt)}` : 'Esperando una fuente verificable'}</p>
          </div>
          <Link href="/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800 hover:underline">
            Abrir reporte completo <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricSurface
            label="Ventas"
            value={report ? formatCurrency(report.sales.total) : undefined}
            unavailable={daily.isError}
            context={report ? `${formatNumber(report.sales.count)} transacciones` : queryContext(daily.isLoading)}
            icon={<CircleDollarSign className="h-5 w-5" />}
            density="compact"
          />
          <MetricSurface
            label="Ticket promedio"
            value={averageTicket == null ? undefined : formatCurrency(averageTicket)}
            unavailable={daily.isError || Boolean(report && report.sales.count === 0)}
            context={report?.sales.count === 0 ? 'Sin ventas para calcular' : queryContext(daily.isLoading)}
            icon={<ReceiptText className="h-5 w-5" />}
            density="compact"
          />
          <MetricSurface
            label="Utilidad bruta"
            value={report ? formatCurrency(report.metrics.grossProfit) : undefined}
            unavailable={daily.isError}
            context={margin == null ? report ? 'Sin base para margen' : queryContext(daily.isLoading) : `${margin.toLocaleString('es-CO', { maximumFractionDigits: 1 })}% de ventas`}
            icon={<TrendingUp className="h-5 w-5" />}
            density="compact"
          />
          <MetricSurface
            label="Gastos"
            value={report ? formatCurrency(report.expenses.total) : undefined}
            unavailable={daily.isError}
            context={report ? `${formatNumber(report.expenses.count)} movimientos` : queryContext(daily.isLoading)}
            icon={<Banknote className="h-5 w-5" />}
            density="compact"
          />
          <MetricSurface
            label="Unidades vendidas"
            value={report ? formatNumber(report.sales.itemsSold) : undefined}
            unavailable={daily.isError}
            context={report ? `${formatNumber(report.sales.canceledCount ?? 0)} ventas canceladas` : queryContext(daily.isLoading)}
            icon={<PackageCheck className="h-5 w-5" />}
            density="compact"
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="best-sellers-title">
          <div className="mb-3">
            <h2 id="best-sellers-title" className="font-heading text-lg font-semibold text-ink">Productos con venta registrada</h2>
            <p className="mt-1 text-sm text-muted">Ranking del periodo seleccionado, sin completar productos ausentes.</p>
          </div>
          <QueryState
            status={queryStatus(daily, report?.sales.bestSellers.length ?? 0)}
            title={daily.isError ? 'No pudimos cargar ventas por producto' : 'No hay ventas por producto'}
            description={daily.isError ? queryErrorDescription(daily.error) : 'El reporte real no registra productos vendidos en esta fecha.'}
            onRetry={daily.isError ? () => void daily.refetch() : undefined}
            skeletonRows={5}
          >
            <DataTableShell rows={report?.sales.bestSellers ?? []} columns={bestSellerColumns} rowKey={(item) => item.productName} caption="Productos vendidos" density="compact" />
          </QueryState>
        </section>

        <section aria-labelledby="channels-title">
          <div className="mb-3">
            <h2 id="channels-title" className="font-heading text-lg font-semibold text-ink">Composición por canal</h2>
            <p className="mt-1 text-sm text-muted">Desglose entregado por el dominio de reportes.</p>
          </div>
          <QueryState
            status={queryStatus(daily, report?.sales.byChannel.length ?? 0)}
            title={daily.isError ? 'No pudimos cargar la composición' : 'Sin desglose por canal'}
            description={daily.isError ? queryErrorDescription(daily.error) : 'El reporte no contiene actividad por canal para esta fecha.'}
            onRetry={daily.isError ? () => void daily.refetch() : undefined}
            skeletonRows={5}
          >
            <DataTableShell rows={report?.sales.byChannel ?? []} columns={breakdownColumns} rowKey={(item) => breakdownLabel(item)} caption="Ventas por canal" density="compact" />
          </QueryState>
        </section>
      </div>

      <section aria-labelledby="quality-title" className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="quality-title" className="font-heading text-lg font-semibold text-ink">Calidad de la señal</h2>
            <p className="mt-1 text-sm text-muted">La analítica se declara no disponible cuando sus dependencias fallan.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-muted">API</dt><dd className="font-semibold text-ink">{observability.data?.status ?? 'No verificada'}</dd></div>
            <div><dt className="text-muted">Errores HTTP</dt><dd className="font-semibold text-ink">{observability.data ? `${(observability.data.metrics.http.errorRate * 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })}%` : 'No disponible'}</dd></div>
            <div><dt className="text-muted">Latencia p95</dt><dd className="font-semibold text-ink">{observability.data?.metrics.http.latencyMs.p95 == null ? 'Sin muestra' : `${observability.data.metrics.http.latencyMs.p95} ms`}</dd></div>
            <div><dt className="text-muted">Base de datos</dt><dd className="font-semibold text-ink">{observability.data ? observability.data.metrics.database.available ? 'Disponible' : 'Degradada' : 'No verificada'}</dd></div>
          </dl>
        </div>
      </section>
    </main>
  );
}

function todayInBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function numeric(value: string | number) {
  return Number(value);
}

function breakdownLabel(item: Breakdown) {
  return item.label ?? item.name ?? item.channel ?? item.paymentMethod ?? 'Sin clasificar';
}

function queryContext(isLoading: boolean) {
  return isLoading ? 'Consultando fuente real' : 'Sin respuesta verificable';
}

function queryStatus(query: { isLoading: boolean; isError: boolean; error: unknown }, count: number) {
  if (query.isLoading) return 'loading' as const;
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'permission_denied' as const : 'error' as const;
  return count === 0 ? 'empty' as const : 'ready' as const;
}

function queryErrorDescription(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'Tu rol no permite consultar los reportes del periodo.';
  return error instanceof Error ? error.message : 'No pudimos verificar la fuente analítica.';
}
