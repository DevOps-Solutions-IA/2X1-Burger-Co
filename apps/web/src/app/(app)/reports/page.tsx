'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileDown, History, MessageCircle, PackageSearch, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricSurface, PageHeader, QueryState, StatusBadge } from '@/components/product';
import { apiFetch, getStoredAccessToken, resolveApiUrl } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import { useAuth } from '@/features/auth/auth-provider';

type ReportMode = 'CURRENT_SESSION' | 'CUSTOM_RANGE';

const numericValueSchema = z.union([z.number(), z.string()]);

const reportSummarySchema = z.object({
  journey: z.object({
    status: z.string(),
    openedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    responsibleUser: z.string().nullable(),
  }).passthrough(),
  cash: z.object({
    expectedAmount: numericValueSchema.nullable(),
    actualAmount: numericValueSchema.nullable(),
    difference: numericValueSchema.nullable(),
  }).passthrough(),
  sales: z.object({
    total: numericValueSchema,
    count: z.number(),
    byPaymentMethod: z.array(z.object({
      paymentMethod: z.string(),
      total: numericValueSchema,
    }).passthrough()),
    byChannel: z.array(z.object({
      label: z.string(),
      count: z.number(),
      total: numericValueSchema,
    }).passthrough()),
  }).passthrough(),
  purchases: z.object({
    total: numericValueSchema,
    count: z.number(),
  }).passthrough(),
  expenses: z.object({
    total: numericValueSchema,
    count: z.number(),
  }).passthrough(),
  metrics: z.object({
    costOfSales: numericValueSchema,
    grossProfit: numericValueSchema,
    netProfit: numericValueSchema,
  }).passthrough(),
}).passthrough();

const dailyClosureSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  createdAt: z.string(),
  journey: z.object({
    responsibleUser: z.string().nullable(),
  }).passthrough().optional(),
}).passthrough();

const supplyAlertItemSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string(),
  suggestedReorderLabel: z.string(),
}).passthrough();

const supplyAlertsSchema = z.object({
  groupedBySupplier: z.array(z.object({
    supplierId: z.string().nullable(),
    supplierName: z.string(),
    supplierPhone: z.string().nullable(),
    items: z.array(supplyAlertItemSchema),
  }).passthrough()),
}).passthrough();

const salesByHourSchema = z.array(z.object({
  hour: z.number(),
  label: z.string(),
  total: z.number(),
  count: z.number(),
}).passthrough());

const productMarginSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number(),
  revenue: z.number(),
  cost: z.number(),
  margin: z.number(),
}).passthrough();

const ingredientRotationSchema = z.object({
  ingredientId: z.string(),
  name: z.string(),
  unit: z.string(),
  outbound: z.number(),
  currentStock: z.number(),
}).passthrough();

const comparisonRangeSchema = z.object({
  salesTotal: z.number(),
  salesCount: z.number(),
  expensesTotal: z.number(),
  expensesCount: z.number(),
});

const comparisonBlockSchema = z.object({
  currentLabel: z.string(),
  previousLabel: z.string(),
  current: comparisonRangeSchema,
  previous: comparisonRangeSchema,
  deltas: z.object({
    salesTotal: z.number(),
    salesCount: z.number(),
    expensesTotal: z.number(),
  }),
});

const comparisonsSchema = z.object({
  day: comparisonBlockSchema,
  week: comparisonBlockSchema,
  month: comparisonBlockSchema,
});

const supplierNotificationSchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string(),
  supplier: z.object({ name: z.string() }).passthrough().nullable().optional(),
}).passthrough();

const generatedSupplierNotificationSchema = z.object({
  whatsappLink: z.string().nullable(),
}).passthrough();

type ComparisonBlock = z.infer<typeof comparisonBlockSchema>;

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManageSupply = Boolean(user?.roles.some((role) => ['admin', 'inventory', 'supervisor'].includes(role)));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
  const [reportMode, setReportMode] = useState<ReportMode>('CURRENT_SESSION');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const isCurrentSession = reportMode === 'CURRENT_SESSION';

  const summary = useQuery({
    queryKey: isCurrentSession ? ['reports-operational'] : ['reports-range', from, to],
    queryFn: async () => reportSummarySchema.parse(
      await apiFetch<unknown>(isCurrentSession ? '/reports/operational' : `/reports/range?from=${from}&to=${to}`),
    ),
  });
  const closures = useQuery({
    queryKey: ['daily-closures', from, to],
    queryFn: async () => z.array(dailyClosureSchema).parse(
      await apiFetch<unknown>(`/reports/daily-closures?from=${from}&to=${to}`),
    ),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const supplyAlerts = useQuery({
    queryKey: ['supply-alerts'],
    queryFn: async () => supplyAlertsSchema.parse(await apiFetch<unknown>('/reports/supply-alerts')),
  });
  const salesByHour = useQuery({
    queryKey: ['sales-by-hour', from, to],
    queryFn: async () => salesByHourSchema.parse(await apiFetch<unknown>(`/reports/sales-by-hour?from=${from}&to=${to}`)),
  });
  const productMargins = useQuery({
    queryKey: ['product-margins', from, to],
    queryFn: async () => z.array(productMarginSchema).parse(
      await apiFetch<unknown>(`/reports/product-margins?from=${from}&to=${to}`),
    ),
  });
  const ingredientRotation = useQuery({
    queryKey: ['ingredient-rotation', from, to],
    queryFn: async () => z.array(ingredientRotationSchema).parse(
      await apiFetch<unknown>(`/reports/ingredient-rotation?from=${from}&to=${to}`),
    ),
  });
  const comparisons = useQuery({
    queryKey: ['report-comparisons', to],
    queryFn: async () => comparisonsSchema.parse(await apiFetch<unknown>(`/reports/comparisons?date=${to}`)),
  });
  const supplierNotifications = useQuery({
    queryKey: ['supplier-notifications'],
    queryFn: async () => z.array(supplierNotificationSchema).parse(
      await apiFetch<unknown>('/reports/supplier-notifications'),
    ),
    enabled: canManageSupply,
  });
  const openPdf = async (path: string) => {
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer');

    try {
      const response = await fetch(`${resolveApiUrl()}${path}`, {
        headers: { Authorization: `Bearer ${getStoredAccessToken() ?? ''}` },
      });
      if (!response.ok) {
        throw new Error('No pudimos abrir el PDF.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (previewWindow) {
        previewWindow.location.href = objectUrl;
        return;
      }

      window.open(objectUrl, '_blank');
    } catch (error) {
      previewWindow?.close();
      toast.error(error instanceof Error ? error.message : 'No pudimos abrir el PDF.');
    }
  };

  const generateSupplierMessage = useMutation({
    mutationFn: async (supplierId: string) => generatedSupplierNotificationSchema.parse(
      await apiFetch<unknown>('/reports/supplier-notifications/manual', {
        method: 'POST',
        body: JSON.stringify({ supplierId }),
      }),
    ),
    onSuccess: async (notification) => {
      toast.success('Mensaje preparado');
      if (notification.whatsappLink) {
        window.open(notification.whatsappLink, '_blank');
      }
      await queryClient.invalidateQueries({ queryKey: ['supplier-notifications'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos preparar el mensaje.'),
  });

  const hourlyTop = useMemo(() => (salesByHour.data ?? []).filter((item) => item.total > 0).slice(0, 8), [salesByHour.data]);
  const displayClosures = useMemo(() => {
    if ((closures.data?.length ?? 0) > 0) {
      return (closures.data ?? []).map((closure) => ({
        id: closure.id,
        periodLabel: closure.periodStart.slice(0, 10),
        createdAt: closure.createdAt,
        responsibleUser: closure.journey?.responsibleUser || 'Sin responsable',
        pdfPath: `/reports/daily-closures/${closure.id}/pdf`,
      }));
    }

    if (isCurrentSession || (from === to && to === today)) {
      return [
        {
          id: isCurrentSession ? 'operational-live' : `daily-${to}`,
          periodLabel: isCurrentSession ? 'Jornada actual' : to,
          createdAt: summary.data?.journey?.closedAt ?? new Date().toISOString(),
          responsibleUser: summary.data?.journey?.responsibleUser || 'Sin responsable',
          pdfPath: isCurrentSession ? '/reports/operational/pdf' : `/reports/daily/${to}/pdf`,
        },
      ];
    }

    return [];
  }, [closures.data, from, isCurrentSession, summary.data?.journey?.closedAt, summary.data?.journey?.responsibleUser, to, today]);

  const activateRangeMode = (next: Partial<{ from: string; to: string }>) => {
    setReportMode('CUSTOM_RANGE');
    if (next.from != null) setFrom(next.from);
    if (next.to != null) setTo(next.to);
  };

  const pdfPath = isCurrentSession ? '/reports/operational/pdf' : `/reports/daily/${to}/pdf`;
  const modeLabel = isCurrentSession ? 'Jornada actual' : 'Rango personalizado';
  const modeDescription = isCurrentSession
    ? summary.data?.journey?.openedAt
      ? `Desde apertura de caja: ${formatDateTime(summary.data.journey.openedAt)} hasta ahora.`
      : 'Desde apertura de caja hasta ahora.'
    : `Reporte del ${from} al ${to}. Puede no coincidir con la jornada actual.`;
  const secondaryFailure = [closures, supplyAlerts, salesByHour, productMargins, ingredientRotation, comparisons]
    .some((query) => query.isError);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia operacional"
        title="Reportes"
        description={modeDescription}
        status={
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="reports-mode-badge">
              <StatusBadge status={isCurrentSession ? 'ACTIVE' : 'CUSTOM_RANGE'} label={modeLabel} tone={isCurrentSession ? 'success' : 'info'} />
            </span>
            <StatusBadge
              status={summary.data?.journey?.status ?? 'UNKNOWN'}
              label={translateJourneyStatus(summary.data?.journey?.status)}
              tone={summary.data?.journey?.status === 'CERRADA' ? 'success' : 'info'}
            />
          </div>
        }
        actions={
          user?.permissions.includes('reports.pdf') ? (
            <Button data-testid="reports-open-pdf" size="sm" onClick={() => openPdf(pdfPath)}>
              <FileDown className="mr-1.5 h-4 w-4" />Abrir PDF
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricSurface density="compact" label="Ventas" value={formatCurrency(summary.data?.sales?.total)} unavailable={!summary.data} context={summary.data ? `${summary.data.sales.count} ventas` : 'Fuente no disponible'} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Compras" value={formatCurrency(summary.data?.purchases?.total)} unavailable={!summary.data} context={summary.data ? `${summary.data.purchases.count} compras` : 'Fuente no disponible'} icon={<CalendarDays className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Gastos" value={formatCurrency(summary.data?.expenses?.total)} unavailable={!summary.data} context={summary.data ? `${summary.data.expenses.count} gastos` : 'Fuente no disponible'} icon={<TrendingUp className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Utilidad neta" value={formatCurrency(summary.data?.metrics?.netProfit)} unavailable={!summary.data} context={summary.data ? 'Resultado del periodo' : 'Fuente no disponible'} icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      {summary.isError ? (
        <QueryState
          status="error"
          title="El resumen financiero no esta disponible"
          description="No reemplazamos datos financieros con ceros. Reintenta antes de tomar decisiones operativas."
          onRetry={() => void summary.refetch()}
        />
      ) : null}

      {secondaryFailure ? (
        <div className="rounded-2xl border border-signal-warning/30 bg-signal-warning/10 px-4 py-3 text-sm text-ink" role="status">
          Una o mas fuentes complementarias no respondieron. Cada bloque afectado permanece sin datos estimados y puede reintentarse al recargar.
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-extrabold text-ink">Filtros</h2>
          <span className="text-[12px] font-medium text-stone-600" data-testid="reports-range-label">
            {isCurrentSession ? 'Jornada actual' : `${from} → ${to}`}
          </span>
        </div>
        <div className="mt-3 flex w-fit rounded-xl border border-line bg-canvas p-1" data-testid="reports-mode-controls">
          <button
            type="button"
            onClick={() => setReportMode('CURRENT_SESSION')}
            className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${isCurrentSession ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            data-testid="reports-mode-current"
          >
            Jornada actual
          </button>
          <button
            type="button"
            onClick={() => setReportMode('CUSTOM_RANGE')}
            className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${!isCurrentSession ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            data-testid="reports-mode-range"
          >
            Rango personalizado
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-stone-600" data-testid="reports-mode-description">
          {modeDescription}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Desde">
            <Input
              type="date"
              value={from}
              onChange={(event) => activateRangeMode({ from: event.target.value })}
              data-testid="reports-date-from"
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={to}
              onChange={(event) => activateRangeMode({ to: event.target.value })}
              data-testid="reports-date-to"
            />
          </Field>
          <div className="flex items-end">
            <div className="inline-flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-[12px] font-medium text-stone-600">
              <CalendarDays className="h-4 w-4" />
              {isCurrentSession ? 'Jornada viva' : `${from} a ${to}`}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Resumen del cierre actual</h2>
              <p className="mt-0.5 text-[12px] text-stone-600">Caja, metodos, canales y costos.</p>
            </div>
          </div>

          {/* Caja fisica — MIRROR CASH STYLE */}
          <div className="rounded-[1.45rem] border border-amber-200 bg-amber-50 p-5 mb-4">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-amber-800">Caja fisica esperada</p>
                <p className="mt-2 text-[2rem] font-black leading-none tracking-tight text-ink tabular-nums">
                  {formatCurrency(summary.data?.cash?.expectedAmount)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-amber-800">Real</p>
                <p className="mt-1 text-[1.2rem] font-extrabold text-ink tabular-nums">{formatCurrency(summary.data?.cash?.actualAmount)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-amber-200/60">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-amber-800">Diferencia</p>
                <p className={`mt-1 text-[1.1rem] font-extrabold tabular-nums ${Number(summary.data?.cash?.difference ?? 0) === 0 ? 'text-emerald-700' : Number(summary.data?.cash?.difference ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(summary.data?.cash?.difference)}</p>
              </div>
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-amber-800">Costo ventas</p>
                <p className="mt-1 text-[1.1rem] font-extrabold text-ink tabular-nums">{formatCurrency(summary.data?.metrics?.costOfSales)}</p>
              </div>
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-amber-800">Margen bruto</p>
                <p className={`mt-1 text-[1.1rem] font-extrabold tabular-nums ${Number(summary.data?.metrics?.grossProfit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(summary.data?.metrics?.grossProfit)}</p>
              </div>
            </div>
          </div>

          {/* Ventas por metodo + Canal — MIRROR CASH STYLE */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-stone-200 bg-white p-4">
              <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-stone-600">Metodo de pago</p>
              <div className="space-y-1.5">
              {(summary.data?.sales?.byPaymentMethod ?? []).map((item) => {
                const isCash = /efectivo|cash/i.test(item.paymentMethod);
                return (
                <div key={item.paymentMethod} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${isCash ? 'bg-brand-400' : 'bg-stone-300'}`} />
                    <span className="text-[12px] font-bold text-stone-700">{item.paymentMethod}</span>
                  </div>
                  <span className="text-[14px] font-extrabold text-ink tabular-nums">{formatCurrency(item.total)}</span>
                </div>
                );
              })}
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-stone-200 bg-white p-4">
              <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-stone-600">Canal</p>
              <div className="space-y-1.5">
              {(summary.data?.sales?.byChannel ?? []).map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                  <div>
                    <span className="text-[12px] font-bold text-stone-700">{item.label}</span>
                    <span className="ml-2 text-[12px] text-stone-600">{item.count} pedidos</span>
                  </div>
                  <span className="text-[14px] font-extrabold text-ink tabular-nums">{formatCurrency(item.total)}</span>
                </div>
              ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <PackageSearch className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Abastecimiento recomendado</h2>
              <p className="mt-0.5 text-[12px] text-stone-600">Insumos con proveedor y contacto rapido.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {supplyAlerts.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />) : null}
            {(supplyAlerts.data?.groupedBySupplier ?? []).slice(0, 5).map((group) => (
              <div key={group.supplierId ?? group.supplierName} className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="space-y-1.5">
                  {group.items.slice(0, 3).map((item) => (
                    <div key={item.ingredientId} className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-extrabold text-ink truncate">{item.ingredientName}</p>
                        <p className="truncate text-[12px] text-stone-600">{group.supplierName} {group.supplierPhone ? `· ${group.supplierPhone}` : '· sin telefono'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] font-bold text-ink tabular-nums">{item.suggestedReorderLabel}</span>
                        {canManageSupply && group.supplierId ? (
                          <button
                            type="button"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-canvas hover:text-signal-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            onClick={() => group.supplierId && generateSupplierMessage.mutate(group.supplierId)}
                            aria-label={`Preparar mensaje para ${group.supplierName}`}
                            disabled={generateSupplierMessage.isPending}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <h2 className="text-[15px] font-extrabold text-ink">Ventas por franja horaria</h2>
          <div className="mt-4 space-y-2.5">
            {hourlyTop.length ? hourlyTop.map((item) => (
              <div key={item.hour} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2.5 border-l-[2px] border-l-brand-300">
                <div>
                  <p className="font-medium text-ink">{item.label}</p>
                  <p className="text-[12px] text-stone-600">{item.count} ventas</p>
                </div>
                <p className="font-semibold text-ink">{formatCurrency(item.total)}</p>
              </div>
            )) : <EmptyState title="Sin ventas en el rango" description="No hay datos para construir la franja horaria." />}
          </div>
        </Card>

        <Card>
          <h2 className="text-[15px] font-extrabold text-ink">Margen por producto</h2>
          <div className="hide-scrollbar list-scroll-5-cards mt-4 space-y-2.5 pr-1">
            {(productMargins.data ?? []).map((item) => (
              <div key={item.productId} className="rounded-xl bg-stone-50 px-3 py-2.5 border-l-[2px] border-l-brand-300">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{item.name}</p>
                  <p className="font-semibold text-ink">{formatCurrency(item.margin)}</p>
                </div>
                <p className="mt-0.5 text-[12px] text-stone-600">
                  Ingreso {formatCurrency(item.revenue)} · costo {formatCurrency(item.cost)} · {item.quantity} uds
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-[15px] font-extrabold text-ink">Rotación de insumos</h2>
          <div className="hide-scrollbar list-scroll-5-cards mt-4 space-y-2.5 pr-1">
            {(ingredientRotation.data ?? []).map((item) => (
              <div key={item.ingredientId} className="rounded-xl bg-stone-50 px-3 py-2.5 border-l-[2px] border-l-brand-300">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{item.name}</p>
                  <p className="font-semibold text-ink">{item.outbound.toFixed(2)} {item.unit}</p>
                </div>
                <p className="mt-0.5 text-[12px] text-stone-600">
                  Cobertura no disponible · stock {item.currentStock}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <h2 className="text-[15px] font-extrabold text-ink">Comparativo diario / semanal / mensual</h2>
          <div className="mt-4 grid gap-3">
            <ComparisonCard title="Diario" data={comparisons.data?.day} loading={comparisons.isLoading} />
            <ComparisonCard title="Semanal" data={comparisons.data?.week} loading={comparisons.isLoading} />
            <ComparisonCard title="Mensual" data={comparisons.data?.month} loading={comparisons.isLoading} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Histórico de cierres</h2>
              <p className="mt-0.5 text-[12px] text-stone-600">Consulta y reimprime cierres guardados.</p>
            </div>
          </div>
          <div className="hide-scrollbar list-scroll-5-cards mt-5 space-y-3 pr-1">
            {closures.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-[1.5rem]" />) : null}
            {displayClosures.map((closure) => (
              <div key={closure.id} className="rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{closure.periodLabel}</p>
                    <p className="mt-0.5 text-[12px] text-stone-600">{formatDateTime(closure.createdAt)} · {closure.responsibleUser}</p>
                  </div>
                  <Button variant="secondary" onClick={() => openPdf(closure.pdfPath)}>
                    Reimprimir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {canManageSupply && supplierNotifications.data?.length ? (
        <Card>
          <h2 className="text-[15px] font-extrabold text-ink">Histórico de notificaciones a proveedor</h2>
          <div className="hide-scrollbar list-scroll-5-cards mt-4 grid gap-3 pr-1 md:grid-cols-2">
            {supplierNotifications.data.map((notification) => (
              <div key={notification.id} className="rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
                <p className="font-medium text-ink">{notification.supplier?.name ?? 'Proveedor'}</p>
                <p className="mt-0.5 text-[12px] text-stone-600">{notification.status} · {formatDateTime(notification.createdAt)}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}



function ComparisonCard({ title, data, loading }: { title: string; data: ComparisonBlock | undefined; loading: boolean }) {
  if (loading) {
    return <Skeleton className="h-28 rounded-[1.5rem]" />;
  }

  if (!data) {
    return <EmptyState title={`Sin comparativo ${title.toLowerCase()}`} description="No hay datos suficientes para calcular este bloque." />;
  }

  return (
    <div className="rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
      <p className="font-semibold text-ink">{title}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white px-3 py-3">
          <p className="text-[12px] text-stone-600">{data.currentLabel}</p>
          <p className="mt-1 font-semibold text-ink">{formatCurrency(data.current.salesTotal)}</p>
          <p className="text-[12px] text-stone-600">{data.current.salesCount} ventas</p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-3">
          <p className="text-[12px] text-stone-600">{data.previousLabel}</p>
          <p className="mt-1 font-semibold text-ink">{formatCurrency(data.previous.salesTotal)}</p>
          <p className="text-[12px] text-stone-600">{data.previous.salesCount} ventas</p>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-3 text-[12px]">
        <span className={Number(data.deltas.salesTotal) >= 0 ? 'text-emerald-700' : 'text-red-700'}>Ventas: {Number(data.deltas.salesTotal) >= 0 ? '+' : ''}{formatCurrency(data.deltas.salesTotal)}</span>
        <span className="text-stone-600">·</span>
        <span className={Number(data.deltas.expensesTotal) <= 0 ? 'text-emerald-700' : 'text-red-700'}>Gastos: {Number(data.deltas.expensesTotal) > 0 ? '+' : ''}{formatCurrency(data.deltas.expensesTotal)}</span>
      </p>
    </div>
  );
}

function translateJourneyStatus(status?: string) {
  const labels: Record<string, string> = {
    ABIERTA: 'Jornada abierta',
    CERRADA: 'Jornada cerrada',
    PENDIENTE_APERTURA: 'Pendiente de apertura',
  };
  return labels[status ?? 'PENDIENTE_APERTURA'] ?? status ?? 'Jornada';
}
