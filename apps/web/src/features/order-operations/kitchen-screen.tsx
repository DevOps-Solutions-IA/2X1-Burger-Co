'use client';

import { useEffect, useState } from 'react';
import { Clock3, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { FilterBar, PageHeader, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { KitchenOrder, OrderStatus, OrderType } from './contracts';
import { elapsedLabel, modifierLabel, orderStatusLabels, orderTypeLabels, paymentSummary } from './presentation';
import { useKitchenQueue, useKitchenTransition, useOrderOperationsRealtime } from './queries';

const PAGE_SIZE = 100;

function queryState(error: unknown, isPending: boolean, hasData: boolean) {
  if (isPending) return 'loading' as const;
  if (error instanceof ApiError && error.status === 403) return 'permission_denied' as const;
  if (error) return 'error' as const;
  return hasData ? 'ready' as const : 'empty' as const;
}

function KitchenCard({ order, now, onTransition, pending }: { order: KitchenOrder; now: number; onTransition: (order: KitchenOrder) => void; pending: boolean }) {
  const payment = paymentSummary(order.orderCheckout);
  const actionLabel = order.status === 'OPEN' ? 'Iniciar preparación' : 'Marcar listo';
  const uncertainPayment = payment.status === 'UNKNOWN_RESULT' || payment.status === 'FINANCIAL_REVIEW_REQUIRED';
  return (
    <article className={cn('flex min-h-[22rem] flex-col overflow-hidden rounded-2xl border bg-panel shadow-sm', order.status === 'IN_PREPARATION' ? 'border-signal-info/40' : 'border-line')} aria-labelledby={`kitchen-order-${order.id}`}>
      <header className="border-b border-line bg-canvas/75 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{orderTypeLabels[order.type]}</p>
            <h2 id={`kitchen-order-${order.id}`} className="mt-1 font-heading text-xl font-bold text-ink">#{order.number}</h2>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 font-heading text-lg font-bold tabular-nums text-ink"><Clock3 className="h-4 w-4" />{elapsedLabel(order.openedAt, now)}</span>
            <p className="mt-1 text-xs text-muted">Abierto {formatDateTime(order.openedAt)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><StatusBadge status={order.status} label={orderStatusLabels[order.status]} /><StatusBadge status={payment.status} label={payment.label} /></div>
        {uncertainPayment ? <p className="mt-3 flex items-start gap-2 rounded-xl border border-signal-warning/30 bg-signal-warning/10 p-2.5 text-sm text-ink"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />Revisión financiera visible. Cocina no declara ni modifica el pago.</p> : null}
      </header>
      <div className="flex-1 space-y-4 p-4">
        {order.items.map((item) => (
          <section key={item.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <div className="flex items-start gap-3"><span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-ink px-2 font-heading text-sm font-bold text-white">{Number(item.quantity).toLocaleString('es-CO')}×</span><div className="min-w-0"><h3 className="font-heading text-base font-bold text-ink">{item.product.name}</h3><p className="mt-0.5 text-xs text-muted">{item.product.code}</p></div></div>
            {item.modifiersSnapshot.length ? <ul className="ml-11 mt-2 space-y-1 text-sm font-medium text-signal-warning">{item.modifiersSnapshot.map((modifier, index) => <li key={`${item.id}-modifier-${index}`}>• {modifierLabel(modifier)}</li>)}</ul> : null}
            {item.notes ? <p className="ml-11 mt-2 rounded-lg bg-canvas p-2 text-sm text-ink">Nota: {item.notes}</p> : null}
          </section>
        ))}
        {order.notes ? <p className="rounded-xl border border-signal-warning/30 bg-signal-warning/10 p-3 text-sm font-medium text-ink"><strong>Nota general:</strong> {order.notes}</p> : null}
      </div>
      <footer className="border-t border-line p-3">
        <Button type="button" className="w-full" disabled={pending} onClick={() => onTransition(order)}>{pending ? 'Actualizando…' : actionLabel}</Button>
      </footer>
    </article>
  );
}

export function KitchenScreen() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [type, setType] = useState<OrderType | ''>('');
  const [now, setNow] = useState(() => Date.now());
  const result = useKitchenQueue({ page: 1, limit: PAGE_SIZE, q: query, status: status || undefined, type: type || undefined });
  const transition = useKitchenTransition();
  useOrderOperationsRealtime();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = result.data?.items ?? [];
  const state = queryState(result.error, result.isPending, items.length > 0);
  const handleTransition = (order: KitchenOrder) => {
    transition.mutate(
      { id: order.id, action: order.status === 'OPEN' ? 'START_PREPARATION' : 'MARK_READY', expectedRevision: order.revision },
      {
        onSuccess: () => toast.success(order.status === 'OPEN' ? `Pedido #${order.number} en preparación.` : `Pedido #${order.number} marcado como listo.`),
        onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la cocina. La orden se refrescará.'),
      },
    );
  };
  const clearFilters = () => { setQuery(''); setStatus(''); setType(''); };

  return (
    <div className="space-y-5 p-3 sm:p-5 lg:p-6" data-testid="kitchen-page">
      <PageHeader
        density="compact"
        eyebrow="Producción"
        title="Cocina"
        description="Cola operativa en tiempo real. El tiempo mostrado es transcurrido, no una promesa de entrega."
        status={<StatusBadge status={result.isFetching ? 'PENDING' : 'ACTIVE'} label={result.isFetching ? 'Sincronizando' : 'Cola conectada'} />}
        actions={<Button type="button" variant="secondary" onClick={() => void result.refetch()} disabled={result.isFetching}><RefreshCw className={cn('h-4 w-4', result.isFetching && 'animate-spin')} />Actualizar</Button>}
      />
      <FilterBar
        density="compact"
        activeCount={Number(Boolean(query)) + Number(Boolean(status)) + Number(Boolean(type))}
        search={<label className="relative block"><span className="sr-only">Buscar orden en cocina</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pedido o cliente" className="pl-10" maxLength={80} /></label>}
        filters={<><label className="min-w-44"><span className="sr-only">Estado de cocina</span><Select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus | '')}><option value="">Abiertos y preparando</option><option value="OPEN">Abiertos</option><option value="IN_PREPARATION">En preparación</option></Select></label><label className="min-w-40"><span className="sr-only">Canal del pedido</span><Select value={type} onChange={(event) => setType(event.target.value as OrderType | '')}><option value="">Todos los canales</option>{Object.entries(orderTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label></>}
        actions={<Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar</Button>}
      />
      <QueryState status={state} title={state === 'empty' ? 'No hay pedidos pendientes en cocina' : undefined} description={state === 'empty' ? 'La cola está al día. Los nuevos pedidos aparecerán cuando el backend los autorice.' : undefined} onRetry={() => void result.refetch()}>
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Cola de cocina">
          {items.map((order) => <KitchenCard key={order.id} order={order} now={now} onTransition={handleTransition} pending={transition.isPending && transition.variables?.id === order.id} />)}
        </section>
      </QueryState>
      {result.data && result.data.total > PAGE_SIZE ? <p className="rounded-xl border border-signal-warning/30 bg-signal-warning/10 p-3 text-sm text-ink">La cola contiene más de {PAGE_SIZE} pedidos. Refina los filtros para operar el resto sin cargar una lista sin límites.</p> : null}
    </div>
  );
}
