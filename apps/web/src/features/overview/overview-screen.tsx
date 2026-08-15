'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  ChefHat,
  CircleDollarSign,
  ClipboardList,
  MessageSquareText,
  ShieldCheck,
  ShoppingBag,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DataTableShell,
  MetricSurface,
  PageHeader,
  QueryState,
  ReadinessSurface,
  StatusBadge,
  type DataTableColumn,
} from '@/components/product';
import { useAuth } from '@/features/auth/auth-provider';
import { canAccessRoute } from '@/features/auth/access-control';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import { describeCustomerAutomation, type OperationalOrder, type OperationalReport } from './contracts';
import {
  useObservabilitySnapshot,
  useOperationalReport,
  useSofiaDashboardSummary,
} from './queries';

const orderColumns: readonly DataTableColumn<OperationalOrder>[] = [
  {
    id: 'order',
    header: 'Pedido',
    cell: (order) => <span className="font-semibold">#{order.number}</span>,
  },
  {
    id: 'customer',
    header: 'Cliente / mesa',
    cell: (order) => order.customerName ?? order.tableLabel ?? 'Sin referencia',
  },
  {
    id: 'type',
    header: 'Canal',
    cell: (order) => order.type.replaceAll('_', ' '),
  },
  {
    id: 'status',
    header: 'Estado',
    cell: (order) => <StatusBadge status={order.status} />,
  },
  {
    id: 'subtotal',
    header: 'Subtotal',
    mobileLabel: 'Subtotal',
    numeric: true,
    cell: (order) => formatCurrency(order.subtotal),
  },
  {
    id: 'updatedAt',
    header: 'Actualizado',
    cell: (order) => formatDateTime(order.updatedAt),
  },
];

export function OverviewScreen() {
  const { user } = useAuth();
  const [attentionFilter, setAttentionFilter] = useState<'ALL' | 'PRODUCTS' | 'INGREDIENTS'>('ALL');
  const canAccess = (pathname: string) => canAccessRoute(pathname, user?.permissions, user?.roles);
  const routeAccess = {
    activationControl: canAccess('/activation-control'),
    analytics: canAccess('/analytics'),
    cash: canAccess('/cash'),
    conversations: canAccess('/conversations'),
    deliveries: canAccess('/deliveries'),
    inventory: canAccess('/inventory'),
    kitchen: canAccess('/kitchen'),
    orders: canAccess('/orders'),
    payments: canAccess('/payments'),
    pos: canAccess('/pos'),
    reports: canAccess('/reports'),
  } as const;
  const operational = useOperationalReport(routeAccess.reports);
  const observability = useObservabilitySnapshot();
  const sofia = useSofiaDashboardSummary();

  const report = operational.data;
  const health = observability.data;
  const sofiaState = sofia.data;
  const activeOrders = report?.operations?.activeOrders ?? [];
  const kitchenOrders = activeOrders.filter((order) => order.status === 'IN_PREPARATION').length;
  const attentionAlerts = buildAttentionAlerts(report).filter((alert) => canAccess(alert.href));
  const productAttention = attentionAlerts.filter((alert) => alert.type === 'product').length;
  const ingredientAttention = attentionAlerts.filter((alert) => alert.type === 'ingredient').length;
  const filteredAttention = attentionAlerts.filter((alert) => {
    if (attentionFilter === 'PRODUCTS') return alert.type === 'product';
    if (attentionFilter === 'INGREDIENTS') return alert.type === 'ingredient';
    return true;
  });
  const financialReview = health
    ? (health.metrics.operational.commerce.checkoutFinancialReviewRequired ?? 0)
      + (health.metrics.operational.commerce.paymentFinancialReviewRequired ?? 0)
      + (health.metrics.operational.paymentWebhooks.financialReviewRequired ?? 0)
    : null;
  const isReady = health?.status === 'READY';
  const automationStatus = health ? describeCustomerAutomation(health.metrics.effectiveFlags) : null;
  const greetingName = user?.fullName?.split(' ')[0];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" data-testid="dashboard-page">
      <PageHeader
        eyebrow="Operación en vivo"
        title="Tu jornada en vivo"
        description={`${greetingForNow()}${greetingName ? `, ${greetingName}` : ''}. Ventas, pedidos y dependencias críticas con datos del dominio; una falla nunca se reemplaza por un cero estimado.`}
        status={health ? <StatusBadge status={health.status} label={isReady ? 'Sistema listo' : 'Sistema degradado'} tone={isReady ? 'success' : 'warning'} /> : undefined}
        actions={routeAccess.orders || routeAccess.pos ? (
          <>
            {routeAccess.orders ? <Button asChild variant="secondary"><Link href="/orders">Ver pedidos</Link></Button> : null}
            {routeAccess.pos ? <Button asChild><Link href="/pos">Abrir POS</Link></Button> : null}
          </>
        ) : undefined}
      />

      {routeAccess.pos || routeAccess.cash || routeAccess.inventory || routeAccess.deliveries ? (
        <section aria-labelledby="quick-access-title">
          <h2 id="quick-access-title" className="font-heading text-lg font-semibold text-ink">Accesos rápidos</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {routeAccess.pos ? <Button asChild><Link href="/pos">Abrir POS</Link></Button> : null}
            {routeAccess.cash ? <Button asChild variant="secondary"><Link href="/cash">Ir a caja</Link></Button> : null}
            {routeAccess.inventory ? <Button asChild variant="secondary"><Link href="/inventory">Ver inventario</Link></Button> : null}
            {routeAccess.deliveries ? <Button asChild variant="secondary"><Link href="/deliveries">Gestionar domicilios</Link></Button> : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="overview-metrics-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="overview-metrics-title" className="font-heading text-lg font-semibold text-ink">Estado del día</h2>
          {report ? <p className="text-xs text-muted">Actualizado {formatDateTime(report.metadata.generatedAt)}</p> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {routeAccess.reports ? (
            <MetricSurface
              label="Ventas hoy"
              value={report ? formatCurrency(report.sales.total) : undefined}
              unavailable={operational.isError}
              context={report ? <MetricLink href="/reports">{formatNumber(report.sales.count)} ventas registradas</MetricLink> : loadingContext(operational.isLoading)}
              icon={<CircleDollarSign className="h-5 w-5" />}
            />
          ) : null}
          {routeAccess.orders && routeAccess.reports ? (
            <MetricSurface
              label="Pedidos activos"
              value={report?.operations ? formatNumber(report.operations.activeOrdersCount) : undefined}
              unavailable={operational.isError || (Boolean(report) && !report?.operations)}
              context={report?.operations ? <MetricLink href="/orders">Abrir cola operacional</MetricLink> : loadingContext(operational.isLoading)}
              icon={<ClipboardList className="h-5 w-5" />}
            />
          ) : null}
          {routeAccess.kitchen && routeAccess.reports ? (
            <MetricSurface
              label="En preparación"
              value={report?.operations ? formatNumber(kitchenOrders) : undefined}
              unavailable={operational.isError || (Boolean(report) && !report?.operations)}
              context={report?.operations ? <MetricLink href="/kitchen">Ver cocina</MetricLink> : loadingContext(operational.isLoading)}
              icon={<ChefHat className="h-5 w-5" />}
            />
          ) : null}
          {routeAccess.payments ? (
            <MetricSurface
              label="Revisión financiera"
              value={financialReview == null ? undefined : formatNumber(financialReview)}
              unavailable={observability.isError}
              context={financialReview == null ? loadingContext(observability.isLoading) : <MetricLink href="/payments">Abrir evidencia</MetricLink>}
              icon={<ShieldCheck className="h-5 w-5" />}
              status={financialReview && financialReview > 0 ? <StatusBadge status="FINANCIAL_REVIEW_REQUIRED" label="Requiere acción" /> : undefined}
            />
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.75fr)]">
        {routeAccess.orders && routeAccess.reports ? <section aria-labelledby="active-orders-title" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="active-orders-title" className="font-heading text-lg font-semibold text-ink">Última actividad</h2>
              <p className="mt-1 text-sm text-muted">Pedidos activos; estado y monto proceden del ticket canónico.</p>
            </div>
            <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800 hover:underline" href="/orders">
              Todos los pedidos <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <QueryState
            status={queryStatus(operational, activeOrders.length)}
            title={operational.isError ? 'Los pedidos no están disponibles' : 'No hay pedidos activos'}
            description={operational.isError ? queryErrorDescription(operational.error) : 'La cola está vacía según el reporte operacional actual.'}
            onRetry={operational.isError ? () => void operational.refetch() : undefined}
            skeletonRows={4}
          >
            <DataTableShell rows={activeOrders.slice(0, 8)} columns={orderColumns} rowKey={(order) => order.id} caption="Pedidos activos" density="compact" />
          </QueryState>
        </section> : null}

        {attentionAlerts.length > 0 || routeAccess.conversations || routeAccess.payments ? (
        <section aria-labelledby="attention-title" className="space-y-3">
          <div>
            <h2 id="attention-title" className="font-heading text-lg font-semibold text-ink">Atención prioritaria</h2>
            <p className="mt-1 text-sm text-muted">Señales reales que requieren revisión humana.</p>
          </div>
          {attentionAlerts.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2" data-testid="attention-tabs" role="group" aria-label="Filtrar alertas de inventario">
                <AttentionTab label="Todos" count={attentionAlerts.length} active={attentionFilter === 'ALL'} onClick={() => setAttentionFilter('ALL')} testId="attention-tab-all" />
                <AttentionTab label="Productos" count={productAttention} active={attentionFilter === 'PRODUCTS'} onClick={() => setAttentionFilter('PRODUCTS')} testId="attention-tab-products" />
                <AttentionTab label="Insumos" count={ingredientAttention} active={attentionFilter === 'INGREDIENTS'} onClick={() => setAttentionFilter('INGREDIENTS')} testId="attention-tab-ingredients" />
              </div>
              {operational.isError ? (
                <QueryState status="error" title="El inventario no está disponible" description={queryErrorDescription(operational.error)} onRetry={() => void operational.refetch()} skeletonRows={2} />
              ) : operational.isLoading ? (
                <QueryState status="loading" title="Consultando alertas" skeletonRows={2} />
              ) : filteredAttention.length === 0 ? (
                <QueryState status="empty" title="Sin alertas en este filtro" description="El reporte operacional no registra elementos pendientes en esta vista." />
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {filteredAttention.map((alert) => (
                    <Link
                      key={alert.id}
                      href={alert.href}
                      data-testid={`attention-card-${alert.type}`}
                      className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 transition hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <TriangleAlert className="h-4 w-4 shrink-0 text-signal-warning" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{alert.label}</span>
                      <StatusBadge status={alert.severity} label={attentionLabel(alert.severity)} tone={alert.severity === 'OUT_OF_STOCK' || alert.severity === 'CRITICAL' ? 'danger' : 'warning'} />
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : null}
          {routeAccess.conversations ? (
            <AttentionLink
              href="/conversations"
              icon={<MessageSquareText className="h-5 w-5" />}
              label="Handoffs humanos"
              value={sofiaState?.conversations.humanRequired ?? null}
              unavailable={sofia.isError}
            />
          ) : null}
          {routeAccess.payments ? (
            <AttentionLink
              href="/payments"
              icon={<ShoppingBag className="h-5 w-5" />}
              label="Pagos en revisión"
              value={financialReview}
              unavailable={observability.isError}
            />
          ) : null}
        </section>
        ) : null}
      </div>

      {routeAccess.reports ? <section aria-labelledby="best-sellers-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="best-sellers-title" className="font-heading text-lg font-semibold text-ink">Lo más vendido</h2>
            <p className="mt-1 text-sm text-muted">Productos con venta registrada en la jornada actual.</p>
          </div>
          {routeAccess.analytics ? (
            <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800 hover:underline" href="/analytics">
              Analizar resultados <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <QueryState
          status={queryStatus(operational, report?.sales.bestSellers.length ?? 0)}
          title={operational.isError ? 'Las ventas por producto no están disponibles' : 'No hay productos vendidos todavía'}
          description={operational.isError ? queryErrorDescription(operational.error) : 'Los productos aparecerán cuando el reporte registre ventas reales.'}
          onRetry={operational.isError ? () => void operational.refetch() : undefined}
          skeletonRows={3}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(report?.sales.bestSellers ?? []).slice(0, 8).map((item) => (
              <article key={item.productName} className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                <p className="truncate font-heading text-sm font-semibold text-ink">{item.productName}</p>
                <p className="mt-3 text-xl font-bold tabular-nums text-ink">{formatNumber(item.quantity)}</p>
                <p className="mt-1 text-xs text-muted">unidades · {formatCurrency(item.total)}</p>
              </article>
            ))}
          </div>
        </QueryState>
      </section> : null}

      <section aria-labelledby="readiness-title">
        <div className="mb-3">
          <h2 id="readiness-title" className="font-heading text-lg font-semibold text-ink">Disponibilidad y controles</h2>
          <p className="mt-1 text-sm text-muted">Lectura operacional; no activa proveedores ni automatizaciones.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <ReadinessSurface
            title="Datos operacionales"
            description="Base de datos y backlog de trabajo."
            state={!health ? 'unknown' : health.metrics.database.available && health.metrics.operational.available ? 'ready' : 'degraded'}
            details={health ? `${formatNumber(health.metrics.database.connections)} conexiones · ${health.metrics.database.queryDurationMs ?? 'sin medición'} ms` : 'Dependencia no disponible'}
          />
          <ReadinessSurface
            title="SOFIA supervisada"
            description="Handoff, conversación y AI sin autoridad transaccional."
            state={!sofiaState ? 'unknown' : sofiaState.general.killSwitchActive || sofiaState.general.globalPaused ? 'blocked' : 'ready'}
            details={sofiaState ? `${sofiaState.ai.aiProvider} · ${sofiaState.ai.aiMode} · ${sofiaState.general.sofiaMode}` : 'Dependencia no disponible'}
            action={routeAccess.activationControl ? <Link className="text-sm font-semibold text-brand-800 hover:underline" href="/activation-control">Control</Link> : undefined}
          />
          <ReadinessSurface
            title="Automatización de clientes"
            description="Envío, auto reply y mutaciones permanecen gobernados."
            state={automationStatus?.state ?? 'unknown'}
            details={automationStatus?.details ?? 'No se pudo verificar el estado efectivo'}
            action={<Bot className="h-5 w-5 text-muted" aria-hidden="true" />}
          />
        </div>
      </section>
    </div>
  );
}

function MetricLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-medium text-brand-800 hover:underline">{children}</Link>;
}

function AttentionLink({
  href,
  icon,
  label,
  value,
  unavailable,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number | null;
  unavailable: boolean;
}) {
  return (
    <Link href={href} className="flex min-h-20 items-center gap-3 rounded-2xl border border-line bg-panel p-4 shadow-sm transition hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-brand-800" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-1 block text-xs text-muted">{unavailable ? 'No disponible' : value == null ? 'Verificando' : value === 0 ? 'Sin pendientes' : `${formatNumber(value)} pendientes`}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
    </Link>
  );
}

type InventoryAttention = {
  id: string;
  type: 'product' | 'ingredient';
  label: string;
  severity: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW';
  href: string;
};

function buildAttentionAlerts(report: OperationalReport | undefined): InventoryAttention[] {
  if (!report) return [];
  const alerts = new Map<string, InventoryAttention>();
  const productSources = [
    { rows: report.replenishment.productOutOfStock, severity: 'OUT_OF_STOCK' as const },
    { rows: report.replenishment.productCriticalStock, severity: 'CRITICAL' as const },
    { rows: report.replenishment.productLowStock, severity: 'LOW' as const },
  ];
  const ingredientSources = [
    { rows: report.replenishment.outOfStock, severity: 'OUT_OF_STOCK' as const },
    { rows: report.replenishment.criticalStock, severity: 'CRITICAL' as const },
    { rows: report.replenishment.lowStock, severity: 'LOW' as const },
  ];

  for (const source of productSources) {
    for (const item of source.rows) {
      if (!item.productId || alerts.has(`product-${item.productId}`)) continue;
      alerts.set(`product-${item.productId}`, {
        id: `product-${item.productId}`,
        type: 'product',
        label: item.productName ?? 'Producto sin nombre',
        severity: source.severity,
        href: `/products?edit=${encodeURIComponent(item.productId)}`,
      });
    }
  }
  for (const source of ingredientSources) {
    for (const item of source.rows) {
      if (!item.ingredientId || alerts.has(`ingredient-${item.ingredientId}`)) continue;
      alerts.set(`ingredient-${item.ingredientId}`, {
        id: `ingredient-${item.ingredientId}`,
        type: 'ingredient',
        label: item.ingredientName ?? 'Insumo sin nombre',
        severity: source.severity,
        href: `/ingredients?edit=${encodeURIComponent(item.ingredientId)}`,
      });
    }
  }

  return [...alerts.values()];
}

function AttentionTab({ label, count, active, onClick, testId }: { label: string; count: number; active: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-line bg-panel text-muted hover:text-ink'}`}
    >
      {label} ({formatNumber(count)})
    </button>
  );
}

function attentionLabel(severity: InventoryAttention['severity']) {
  if (severity === 'OUT_OF_STOCK') return 'Agotado';
  if (severity === 'CRITICAL') return 'Crítico';
  return 'Bajo';
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function loadingContext(isLoading: boolean) {
  return isLoading ? 'Consultando fuente real' : 'Sin respuesta verificable';
}

function queryStatus(query: { isLoading: boolean; isError: boolean; error: unknown }, count: number) {
  if (query.isLoading) return 'loading' as const;
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'permission_denied' as const : 'error' as const;
  if (count === 0) return 'empty' as const;
  return 'ready' as const;
}

function queryErrorDescription(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'Tu rol no permite consultar el reporte operacional.';
  return error instanceof Error ? error.message : 'No pudimos verificar la fuente operacional.';
}
