'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AlertTriangle,
  CircleDollarSign,
  ShoppingBasket,
  WalletCards,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-provider';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function getTimeLabel(): string {
  return new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

type DashboardStockAlert = {
  id: string;
  type: 'product' | 'ingredient';
  label: string;
  categoryName: string | null;
  currentStock: number | string;
  stockMin: number | string | null;
  missingQty: number | string | null;
  unitCode: string | null;
  daysOfCoverage: number | null;
  suggestedQuantity: number | string | null;
  severity: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW';
  href: string;
};

type AttentionFilter = 'ALL' | 'PRODUCTS' | 'INGREDIENTS';

const numericValueSchema = z.union([z.number(), z.string()]);

const productStockAlertSchema = z.object({
  productId: z.string(),
  productName: z.string().optional(),
  categoryName: z.string().nullable().optional(),
  currentStock: numericValueSchema.optional(),
  stockMin: numericValueSchema.nullable().optional(),
  missingQty: numericValueSchema.nullable().optional(),
  unit: z.string().nullable().optional(),
  suggestedQuantity: numericValueSchema.nullable().optional(),
}).passthrough();

const ingredientStockAlertSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string().optional(),
  currentStock: numericValueSchema.optional(),
  stockMin: numericValueSchema.nullable().optional(),
  unit: z.string().nullable().optional(),
  suggestedQuantity: numericValueSchema.nullable().optional(),
}).passthrough();

const replenishmentSchema = z.object({
  productOutOfStock: z.array(productStockAlertSchema).default([]),
  productCriticalStock: z.array(productStockAlertSchema).default([]),
  productLowStock: z.array(productStockAlertSchema).default([]),
  outOfStock: z.array(ingredientStockAlertSchema).default([]),
  criticalStock: z.array(ingredientStockAlertSchema).default([]),
  lowStock: z.array(ingredientStockAlertSchema).default([]),
}).passthrough();

const dashboardReportSchema = z.object({
  journey: z.object({
    status: z.string(),
  }).passthrough(),
  cash: z.object({
    expectedAmount: numericValueSchema.nullable(),
  }).passthrough(),
  sales: z.object({
    total: numericValueSchema,
    count: z.number(),
    itemsSold: numericValueSchema,
    bestSellers: z.array(z.object({
      productName: z.string(),
      quantity: numericValueSchema,
      total: numericValueSchema,
    }).passthrough()),
  }).passthrough(),
  expenses: z.object({
    total: numericValueSchema,
    count: z.number(),
  }).passthrough(),
  metrics: z.object({
    netProfit: numericValueSchema,
  }).passthrough(),
  replenishment: replenishmentSchema,
}).passthrough();

const currentCashSchema = z.object({
  openingAmount: numericValueSchema,
}).passthrough().nullable();

const inventoryMovementSchema = z.object({
  id: z.string(),
  type: z.string(),
  quantity: numericValueSchema,
  occurredAt: z.string(),
  product: z.object({ name: z.string() }).passthrough().nullable().optional(),
  ingredient: z.object({ name: z.string() }).passthrough().nullable().optional(),
}).passthrough();

type DashboardReplenishment = z.infer<typeof replenishmentSchema>;

export default function DashboardPage() {
  const { user } = useAuth();
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('ALL');
  const greeting = getGreeting();
  const today = getTodayLabel();
  const now = getTimeLabel();
  const operatorName = user?.fullName?.split(' ')[0] ?? '';

  const dailyReport = useQuery({
    queryKey: ['reports-operational'],
    queryFn: async () => dashboardReportSchema.parse(await apiFetch<unknown>('/reports/operational')),
  });
  const currentCash = useQuery({
    queryKey: ['current-cash'],
    queryFn: async () => currentCashSchema.parse(await apiFetch<unknown>('/cash-register/current')),
  });
  const inventoryMovements = useQuery({
    queryKey: ['inventory-movements'],
    queryFn: async () => z.array(inventoryMovementSchema).parse(await apiFetch<unknown>('/inventory/movements')),
  });

  const journeyClosed = dailyReport.data?.journey?.status === 'CERRADA';
  const cashOpen = Boolean(currentCash.data);
  const cashStatusLabel = journeyClosed
    ? 'Jornada finalizada'
    : cashOpen
      ? 'Caja operativa'
      : 'Sin caja activa';
  const cashTone = journeyClosed ? 'warning' : cashOpen ? 'success' : 'neutral';

  const alerts = buildDashboardAlerts(dailyReport.data?.replenishment);
  const alertCount = alerts.length;
  const productAlertCount = alerts.filter((alert) => alert.type === 'product').length;
  const ingredientAlertCount = alerts.filter((alert) => alert.type === 'ingredient').length;
  const filteredAlerts = alerts.filter((alert) => {
    if (attentionFilter === 'PRODUCTS') return alert.type === 'product';
    if (attentionFilter === 'INGREDIENTS') return alert.type === 'ingredient';
    return true;
  });

  return (
    <div className="space-y-6 p-6 lg:p-8" data-testid="dashboard-page">
      {/* ── Header operativo ── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-700">
            {today} · {now}
          </p>
          <h1 className="mt-2 text-[1.66rem] font-bold tracking-tight text-ink lg:text-[1.86rem]">
            {greeting}{operatorName ? `, ${operatorName}` : ''}
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-5.5 text-stone-600 lg:text-[13.5px] lg:leading-6">
            Tu centro de operaciones. Sin perder un peso.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone={cashTone}>
            {cashStatusLabel}
          </Badge>
          {alertCount > 0 ? (
            <Badge tone="warning">
              {alertCount} {alertCount === 1 ? 'alerta' : 'alertas'}
            </Badge>
          ) : null}
        </div>
      </header>

      {/* ── Status banners ── */}
      {journeyClosed ? (
        <StatusBanner tone="info" title="La jornada anterior ya esta cerrada" description="Este tablero muestra la jornada actual." />
      ) : !cashOpen ? (
        <StatusBanner tone="warning" title="Abrí la caja para empezar a operar" description="Puedes revisar el tablero, pero las ventas y gastos requieren caja abierta." />
      ) : null}
{/* ── KPIs principales ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ventas hoy"
          value={formatCurrency(dailyReport.data?.sales?.total)}
          hint={`${dailyReport.data?.sales?.count ?? 0} ventas registradas`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <MetricCard
          label={cashOpen ? 'Caja operativa' : 'Caja al cierre'}
          value={formatCurrency(dailyReport.data?.cash?.expectedAmount)}
          hint={cashOpen ? `Abierta con ${formatCurrency(currentCash.data?.openingAmount)}` : 'Resultado del día para el cierre'}
          icon={<WalletCards className="h-5 w-5" />}
          accent={cashOpen ? 'success' : 'ink'}
        />
        <MetricCard
          label="Gastos"
          value={formatCurrency(dailyReport.data?.expenses?.total)}
          hint={`${dailyReport.data?.expenses?.count ?? 0} egresos registrados`}
          icon={<ShoppingBasket className="h-5 w-5" />}
          accent="danger"
        />
        <MetricCard
          label="Utilidad neta"
          value={formatCurrency(dailyReport.data?.metrics?.netProfit)}
          hint="Después de costos y gastos"
          icon={<CircleDollarSign className="h-5 w-5" />}
          accent="brand"
        />
      </div>

      {/* ── Estado del día + Atención requerida ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="flex flex-col">
          <h2 className="text-[15px] font-extrabold text-ink">Estado del dia</h2>
          <div className="mt-4 grid flex-1 gap-2.5 sm:grid-cols-2">
            <div className={`flex flex-col justify-center rounded-xl border border-l-[3px] px-4 py-4 ${cashOpen ? 'border-l-emerald-500 bg-emerald-50/60' : journeyClosed ? 'border-l-amber-500 bg-amber-50/60' : 'border-l-red-500 bg-red-50/60'}`}>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Caja</p>
              <p className="mt-2 text-[1.3rem] font-extrabold leading-none text-ink">{journeyClosed ? 'Cerrada' : cashOpen ? 'Operativa' : 'Pendiente'}</p>
              <p className="mt-1.5 text-[10px] font-medium text-stone-500">{journeyClosed ? 'Jornada finalizada' : cashOpen ? `Abierta ${formatCurrency(currentCash.data?.openingAmount)}` : 'Abrir caja'}</p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-l-[3px] border-l-brand-500 bg-brand-50/60 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Ventas</p>
              <p className="mt-2 text-[1.3rem] font-extrabold leading-none text-ink tabular-nums">{formatCurrency(dailyReport.data?.sales?.total ?? 0)}</p>
              <p className="mt-1.5 text-[10px] font-medium text-stone-500">{dailyReport.data?.sales?.count ?? 0} ventas &middot; {dailyReport.data?.sales?.itemsSold ?? 0} uds</p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-l-[3px] border-l-red-500 bg-red-50/60 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Gastos</p>
              <p className="mt-2 text-[1.3rem] font-extrabold leading-none text-ink tabular-nums">{formatCurrency(dailyReport.data?.expenses?.total)}</p>
              <p className="mt-1.5 text-[10px] font-medium text-stone-500">{dailyReport.data?.expenses?.count ?? 0} egresos</p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-l-[3px] border-l-stone-400 bg-stone-50/80 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Utilidad</p>
              <p className="mt-2 text-[1.3rem] font-extrabold leading-none text-ink tabular-nums">{formatCurrency(dailyReport.data?.metrics?.netProfit)}</p>
              <p className="mt-1.5 text-[10px] font-medium text-stone-500">Resultado neto</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-[15px] font-extrabold text-ink">Atencion requerida</h2>
            <Badge tone={alertCount ? 'danger' : 'success'}>{alertCount}</Badge>
          </div>
          <div className="mb-3 flex gap-1.5" data-testid="attention-tabs">
            <AttentionTab label="Todos" count={alertCount} active={attentionFilter === 'ALL'} onClick={() => setAttentionFilter('ALL')} testId="attention-tab-all" />
            <AttentionTab label="Productos" count={productAlertCount} active={attentionFilter === 'PRODUCTS'} onClick={() => setAttentionFilter('PRODUCTS')} testId="attention-tab-products" />
            <AttentionTab label="Insumos" count={ingredientAlertCount} active={attentionFilter === 'INGREDIENTS'} onClick={() => setAttentionFilter('INGREDIENTS')} testId="attention-tab-ingredients" />
          </div>
          <div className="hide-scrollbar max-h-[18rem] space-y-1.5 overflow-y-auto pr-1">
            {dailyReport.isLoading
              ? Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-14 rounded-xl" />))
              : null}
            {!dailyReport.isLoading && filteredAlerts.length > 0
              ? filteredAlerts.map((alert) => (
                  <Link key={alert.id} href={alert.href} data-testid={`attention-card-${alert.type}`}
                    className={`flex items-center justify-between gap-3 rounded-xl border border-l-[3px] px-3.5 py-2.5 transition hover:bg-stone-50 ${
                      isCriticalAttention(alert.severity)
                        ? 'border-red-200 border-l-red-600 bg-red-50 hover:border-red-300'
                        : 'border-amber-200 border-l-amber-500 bg-amber-50 hover:border-amber-300'
                    }`}
                  >
                    <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${isCriticalAttention(alert.severity) ? 'text-red-500' : 'text-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-extrabold text-ink truncate">{alert.label}</p>
                      <p className="mt-0.5 text-[10px] text-stone-500">{alert.type === 'product' ? 'Producto' : 'Insumo'} &middot; {alert.severity === 'OUT_OF_STOCK' ? 'Agotado' : alert.severity === 'CRITICAL' ? 'Critico' : 'Bajo'}</p>
                    </div>
                    <span className="text-[11px] font-bold text-stone-500 shrink-0">{alert.missingQty != null && Number(alert.missingQty) > 0 ? `${Number(alert.missingQty)} uds` : ''}</span>
                  </Link>
                ))
              : null}

            {!dailyReport.isLoading && alertCount === 0 ? (
              <EmptyState
                title="Nada crítico hoy"
                description="Todo en orden. No hay productos ni insumos que requieran tu atención ahora."
              />
            ) : null}
            {!dailyReport.isLoading && alertCount > 0 && filteredAlerts.length === 0 ? (
              <EmptyState
                title="Sin alertas en este filtro"
                description="Cambia a Todos para ver el resto de productos e insumos que necesitan atención."
              />
            ) : null}
          </div>
        </Card>
      </div>

      {/* ── Lo más vendido + Última actividad ── */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex flex-col">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Lo más vendido</h2>
              <p className="mt-1 text-[13px] leading-6 text-stone-600">
                Para que no te falte nada mañana.
              </p>
            </div>
            <Badge tone="default">{dailyReport.data?.sales?.bestSellers?.length ?? 0}</Badge>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-rows flex-1 space-y-3 pr-1"
            role="region"
            aria-label="Productos mas vendidos"
            tabIndex={0}
          >
            {dailyReport.isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-2xl" />
                ))
              : null}

            {!dailyReport.isLoading && dailyReport.data?.sales?.bestSellers?.length ? (
              dailyReport.data.sales.bestSellers.map((item) => (
                <div
                  key={item.productName}
                  className="flex items-center justify-between gap-4 rounded-[1.35rem] border border-stone-200/80 border-l-[4px] border-l-brand-500 bg-brand-50/40 px-4 py-3.5 transition hover:shadow-soft"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{item.productName}</p>
                    <p className="mt-1 text-[13px] text-stone-600">{item.quantity} unidades vendidas</p>
                  </div>
                  <p className="numeric-tabular shrink-0 font-bold text-ink">{formatCurrency(item.total)}</p>
                </div>
              ))
            ) : null}

            {!dailyReport.isLoading && !dailyReport.data?.sales?.bestSellers?.length ? (
              <EmptyState
                title="Tu primera venta del día va a aparecer acá"
                description="Apenas registres una venta, la vas a ver reflejada."
              />
            ) : null}
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Última actividad</h2>
              <p className="mt-1 text-[13px] leading-6 text-stone-600">
                Lo que entró y salió.
              </p>
            </div>
            <Badge tone="default">{inventoryMovements.data?.length ?? 0}</Badge>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-rows flex-1 space-y-3 pr-1"
            role="region"
            aria-label="Ultimos movimientos de inventario"
            tabIndex={0}
          >
            {inventoryMovements.isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-2xl" />
                ))
              : null}

            {!inventoryMovements.isLoading &&
              inventoryMovements.data?.map((movement) => (
                <div key={movement.id} className="rounded-[1.35rem] border border-stone-200/80 bg-stone-50/80 px-4 py-3.5 transition hover:shadow-soft">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        {movement.product?.name ?? movement.ingredient?.name ?? 'Movimiento'}
                      </p>
                      <p className="mt-1 text-[13px] text-stone-600">{translateMovementType(movement.type)}</p>
                    </div>
                    <div className="shrink-0 text-right text-[13px] text-stone-600">
                      <p className="numeric-tabular font-semibold text-ink">{movement.quantity}</p>
                      <p className="mt-1 whitespace-nowrap">{formatDateTime(movement.occurredAt)}</p>
                    </div>
                  </div>
                </div>
              ))}

            {!inventoryMovements.isLoading && !inventoryMovements.data?.length ? (
              <EmptyState
                title="Aún no hay movimientos en esta jornada"
                description="Acá vas a ver compras, ventas y ajustes a medida que ocurran."
              />
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function translateMovementType(type: string) {
  const labels: Record<string, string> = {
    PURCHASE: 'Compra',
    SALE: 'Venta',
    ADJUSTMENT: 'Ajuste',
    WASTE: 'Merma',
    DAMAGE: 'Daño',
    RECIPE_CONSUMPTION: 'Consumo por receta',
  };
  return labels[type] ?? type;
}

function buildDashboardAlerts(replenishment: DashboardReplenishment | undefined): DashboardStockAlert[] {
  const seen = new Set<string>();
  const alerts: DashboardStockAlert[] = [];

  const addAlert = (alert: DashboardStockAlert) => {
    if (seen.has(alert.id)) return;
    seen.add(alert.id);
    alerts.push(alert);
  };

  const productSources = [
    { items: replenishment?.productOutOfStock ?? [], severity: 'OUT_OF_STOCK' as const },
    { items: replenishment?.productCriticalStock ?? [], severity: 'CRITICAL' as const },
    { items: replenishment?.productLowStock ?? [], severity: 'LOW' as const },
  ];

  for (const source of productSources) {
    for (const item of source.items) {
      const currentStock = Number(item.currentStock ?? 0);
      const stockMin = Number(item.stockMin ?? 0);
      addAlert({
        id: `product-${item.productId}`,
        type: 'product',
        label: item.productName ?? 'Producto',
        categoryName: item.categoryName ?? null,
        currentStock,
        stockMin,
        missingQty: item.missingQty ?? Math.max(stockMin - currentStock, 0),
        unitCode: item.unit ?? 'unit',
        daysOfCoverage: null,
        suggestedQuantity: item.suggestedQuantity ?? Math.max(Math.ceil(stockMin * 2 - currentStock), 1),
        severity: source.severity,
        href: `/products?edit=${item.productId}`,
      });
    }
  }

  const ingredientSources = [
    { items: replenishment?.outOfStock ?? [], severity: 'OUT_OF_STOCK' as const },
    { items: replenishment?.criticalStock ?? [], severity: 'CRITICAL' as const },
    { items: replenishment?.lowStock ?? [], severity: 'LOW' as const },
  ];

  for (const source of ingredientSources) {
    for (const item of source.items) {
      const currentStock = Number(item.currentStock ?? 0);
      const stockMin = Number(item.stockMin ?? 0);
      addAlert({
        id: `ingredient-${item.ingredientId}`,
        type: 'ingredient',
        label: item.ingredientName ?? 'Insumo',
        categoryName: null,
        currentStock,
        stockMin,
        missingQty: Math.max(stockMin - currentStock, 0),
        unitCode: item.unit ?? null,
        daysOfCoverage: null,
        suggestedQuantity: item.suggestedQuantity ?? null,
        severity: source.severity,
        href: `/ingredients?edit=${item.ingredientId}`,
      });
    }
  }

  return alerts.sort((left, right) => {
    const severityRank = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2 };
    const bySeverity = severityRank[left.severity] - severityRank[right.severity];
    if (bySeverity !== 0) return bySeverity;
    return left.label.localeCompare(right.label, 'es');
  });
}

function isCriticalAttention(severity: DashboardStockAlert['severity']) {
  return severity === 'OUT_OF_STOCK' || severity === 'CRITICAL';
}

function AttentionTab({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition ${
        active
          ? 'border-red-300 bg-red-50 text-red-700 shadow-sm'
          : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:text-ink'
      }`}
    >
      {label} <span className="tabular-nums">({count})</span>
    </button>
  );
}
