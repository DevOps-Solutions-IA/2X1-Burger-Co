'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Search, ShoppingBag } from 'lucide-react';
import {
  DataTableShell,
  FilterBar,
  MetricSurface,
  PageHeader,
  QueryState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { OperationalOrder, OrderStatus, OrderType } from './contracts';
import { useOperationalOrders, useOrderOperationsRealtime } from './queries';
import { orderStatusLabels, orderTotal, orderTypeLabels, paymentSummary } from './presentation';

const PAGE_SIZE = 25;

function queryState(error: unknown, isPending: boolean, hasData: boolean) {
  if (isPending) return 'loading' as const;
  if (error instanceof ApiError && error.status === 403) return 'permission_denied' as const;
  if (error) return 'error' as const;
  if (!hasData) return 'empty' as const;
  return 'ready' as const;
}

export function OrdersScreen() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [type, setType] = useState<OrderType | ''>('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const result = useOperationalOrders({
    page,
    limit: PAGE_SIZE,
    q: deferredQuery,
    status: status || undefined,
    type: type || undefined,
    activeOnly,
  });
  useOrderOperationsRealtime();

  const items = result.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil((result.data?.total ?? 0) / PAGE_SIZE));
  const state = queryState(result.error, result.isPending, items.length > 0);
  const columns: DataTableColumn<OperationalOrder>[] = [
    {
      id: 'order',
      header: 'Pedido',
      cell: (order) => (
        <div>
          <p className="font-heading font-semibold text-ink">#{order.number}</p>
          <p className="mt-1 text-xs text-muted">{formatDateTime(order.openedAt)}</p>
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Cliente',
      cell: (order) => (
        <div>
          <p className="font-medium">{order.customerName ?? 'Cliente no identificado'}</p>
          {order.customerPhone ? <p className="mt-1 text-xs text-muted">{order.customerPhone}</p> : null}
        </div>
      ),
    },
    {
      id: 'channel',
      header: 'Canal',
      cell: (order) => <span className="font-medium">{orderTypeLabels[order.type]}</span>,
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (order) => <StatusBadge status={order.status} label={orderStatusLabels[order.status]} />,
    },
    {
      id: 'payment',
      header: 'Pago',
      cell: (order) => {
        const payment = paymentSummary(order.orderCheckout);
        return <StatusBadge status={payment.status} label={payment.label} />;
      },
    },
    {
      id: 'total',
      header: 'Total',
      numeric: true,
      className: 'text-right',
      cell: (order) => <span className="font-semibold">{formatCurrency(orderTotal(order.subtotal, order.deliveryFee))}</span>,
    },
  ];

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setQuery('');
    setStatus('');
    setType('');
    setActiveOnly(false);
    resetPage();
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="orders-page">
      <PageHeader
        eyebrow="Operación comercial"
        title="Pedidos"
        description="Consulta el estado comercial, financiero y de entrega sin sustituir la autoridad del backend."
        status={<StatusBadge status={result.isFetching ? 'PENDING' : 'ACTIVE'} label={result.isFetching ? 'Actualizando' : 'Datos operativos'} />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricSurface density="compact" label="Resultados" value={result.data?.total ?? '—'} unavailable={!result.data} icon={<ShoppingBag className="h-4 w-4" />} />
        <MetricSurface density="compact" label="En esta página" value={result.data ? items.length : '—'} unavailable={!result.data} context={`Página ${page} de ${pageCount}`} />
        <MetricSurface density="compact" label="Casos relacionados" value={result.data ? items.reduce((sum, item) => sum + item._count.customerServiceCases, 0) : '—'} unavailable={!result.data} context="Conteo de la página visible" />
      </div>

      <FilterBar
        activeCount={Number(Boolean(query)) + Number(Boolean(status)) + Number(Boolean(type)) + Number(activeOnly)}
        search={(
          <label className="relative block">
            <span className="sr-only">Buscar pedido, cliente o teléfono</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => { setQuery(event.target.value); resetPage(); }}
              placeholder="Pedido, cliente o teléfono"
              className="pl-10"
              maxLength={80}
            />
          </label>
        )}
        filters={(
          <>
            <label className="min-w-44">
              <span className="sr-only">Filtrar por estado</span>
              <Select value={status} onChange={(event) => { setStatus(event.target.value as OrderStatus | ''); resetPage(); }}>
                <option value="">Todos los estados</option>
                {Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="min-w-40">
              <span className="sr-only">Filtrar por canal</span>
              <Select value={type} onChange={(event) => { setType(event.target.value as OrderType | ''); resetPage(); }}>
                <option value="">Todos los canales</option>
                {Object.entries(orderTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-canvas px-3 text-sm font-medium text-ink">
              <input type="checkbox" checked={activeOnly} onChange={(event) => { setActiveOnly(event.target.checked); setStatus(''); resetPage(); }} className="h-4 w-4 accent-brand-600" />
              Solo activos
            </label>
          </>
        )}
        actions={<Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar</Button>}
      />

      <QueryState
        status={state}
        title={state === 'empty' ? 'No hay pedidos con estos filtros' : undefined}
        onRetry={() => void result.refetch()}
      >
        <DataTableShell
          rows={items}
          columns={columns}
          rowKey={(order) => order.id}
          caption="Pedidos operativos"
          density="compact"
          rowActions={(order) => (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/orders/${order.id}`} aria-label={`Ver pedido ${order.number}`}><Eye className="h-4 w-4" />Ver</Link>
            </Button>
          )}
        />
      </QueryState>

      {result.data && result.data.total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Paginación de pedidos">
          <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft className="h-4 w-4" />Anterior
          </Button>
          <span className="text-sm font-medium text-muted">Página {page} de {pageCount}</span>
          <Button type="button" variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
            Siguiente<ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
