'use client';

import Link from 'next/link';
import { ArrowLeft, Bike, CircleDollarSign, Clock3, ReceiptText, UserRound } from 'lucide-react';
import { DataTableShell, PageHeader, QueryState, StatusBadge, Timeline, type DataTableColumn } from '@/components/product';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { OrderDetail } from './contracts';
import { modifierLabel, orderStatusLabels, orderTotal, orderTypeLabels } from './presentation';
import { useOrderDetail } from './queries';

function detailState(error: unknown, isPending: boolean, hasData: boolean) {
  if (isPending) return 'loading' as const;
  if (error instanceof ApiError && error.status === 403) return 'permission_denied' as const;
  if (error) return 'error' as const;
  return hasData ? 'ready' as const : 'empty' as const;
}

function paymentEvidence(order: OrderDetail) {
  if (order.sale) {
    return {
      status: order.sale.status,
      label: order.sale.status === 'PAID' ? 'Venta pagada' : `Venta ${order.sale.status.toLowerCase()}`,
      description: `${order.sale.payments.length} registro${order.sale.payments.length === 1 ? '' : 's'} de pago canónico`,
    };
  }
  if (order.whatsappDeliveryOrder) {
    return {
      status: order.whatsappDeliveryOrder.paymentStatus,
      label: order.whatsappDeliveryOrder.paymentStatus.replaceAll('_', ' '),
      description: order.whatsappDeliveryOrder.paymentReviewReason ?? order.whatsappDeliveryOrder.paymentFailureReason ?? 'Evidencia de pago de domicilio',
    };
  }
  return { status: 'UNAVAILABLE', label: 'Sin evidencia financiera asociada', description: 'No se infiere pago por el estado del pedido.' };
}

export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const result = useOrderDetail(orderId);
  const state = detailState(result.error, result.isPending, Boolean(result.data));
  const order = result.data;

  if (!order) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <QueryState status={state} title={state === 'empty' ? 'Pedido no encontrado' : undefined} onRetry={() => void result.refetch()} />
      </div>
    );
  }

  const payment = paymentEvidence(order);
  const itemColumns: DataTableColumn<OrderDetail['items'][number]>[] = [
    {
      id: 'product',
      header: 'Producto',
      cell: (item) => (
        <div>
          <p className="font-semibold">{item.product.name}</p>
          <p className="mt-1 text-xs text-muted">{item.product.code}{item.product.category?.name ? ` · ${item.product.category.name}` : ''}</p>
        </div>
      ),
    },
    { id: 'quantity', header: 'Cantidad', numeric: true, cell: (item) => Number(item.quantity).toLocaleString('es-CO') },
    {
      id: 'modifiers',
      header: 'Modificaciones',
      cell: (item) => item.modifiersSnapshot.length ? (
        <ul className="space-y-1 text-sm text-muted">{item.modifiersSnapshot.map((modifier, index) => <li key={`${item.id}-${index}`}>{modifierLabel(modifier)}</li>)}</ul>
      ) : <span className="text-muted">Sin modificaciones</span>,
    },
    { id: 'unitPrice', header: 'Unitario', numeric: true, className: 'text-right', cell: (item) => formatCurrency(item.unitPrice) },
    { id: 'total', header: 'Total', numeric: true, className: 'text-right', cell: (item) => <span className="font-semibold">{formatCurrency(item.totalPrice)}</span> },
  ];
  const timeline = [
    { id: 'opened', title: 'Pedido abierto', timestamp: formatDateTime(order.openedAt), description: `${orderTypeLabels[order.type]} · creado por ${order.createdBy.fullName}`, tone: 'info' as const },
    ...(order.servedAt ? [{ id: 'served', title: 'Pedido listo / servido', timestamp: formatDateTime(order.servedAt), tone: 'success' as const }] : []),
    ...(order.paidAt ? [{ id: 'paid', title: 'Pago registrado en la orden', timestamp: formatDateTime(order.paidAt), tone: 'success' as const }] : []),
    ...(order.cancelledAt ? [{ id: 'cancelled', title: 'Pedido cancelado', timestamp: formatDateTime(order.cancelledAt), tone: 'danger' as const }] : []),
    ...(order.deliveryDispatchedAt ? [{ id: 'dispatched', title: 'Domicilio en tránsito', timestamp: formatDateTime(order.deliveryDispatchedAt), tone: 'info' as const }] : []),
    ...(order.deliveryDeliveredAt ? [{ id: 'delivered', title: 'Domicilio entregado', timestamp: formatDateTime(order.deliveryDeliveredAt), tone: 'success' as const }] : []),
    ...(order.whatsappDeliveryOrder?.paymentEvents ?? []).map((event) => ({
      id: `payment-${event.id}`,
      title: `Pago: ${event.newStatus.replaceAll('_', ' ')}`,
      timestamp: formatDateTime(event.createdAt),
      description: event.message ?? `${event.previousStatus ?? 'SIN_ESTADO'} → ${event.newStatus}`,
      tone: event.newStatus === 'PAID' ? 'success' as const : event.newStatus.includes('FAILED') ? 'danger' as const : 'warning' as const,
    })),
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="order-detail-page">
      <PageHeader
        eyebrow="Detalle operativo"
        title={`Pedido #${order.number}`}
        description={`Revisión ${order.revision} · actualizado ${formatDateTime(order.updatedAt)}`}
        breadcrumbs={<Link href="/orders" className="inline-flex min-h-11 items-center gap-2 font-medium hover:text-ink"><ArrowLeft className="h-4 w-4" />Volver a pedidos</Link>}
        status={<StatusBadge status={order.status} label={orderStatusLabels[order.status]} />}
        actions={<Button asChild variant="secondary"><Link href="/kitchen">Abrir cocina</Link></Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="items-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Comanda</p><h2 id="items-title" className="mt-1 font-heading text-lg font-bold text-ink">Productos y modificaciones</h2></div>
              <span className="text-sm font-medium text-muted">{order.items.length} líneas</span>
            </div>
            <DataTableShell rows={order.items} columns={itemColumns} rowKey={(item) => item.id} caption={`Productos del pedido ${order.number}`} density="compact" />
            {order.notes ? <div className="mt-4 rounded-xl border border-signal-warning/25 bg-signal-warning/10 p-3 text-sm text-ink"><strong>Nota:</strong> {order.notes}</div> : null}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="timeline-title">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Evidencia</p>
            <h2 id="timeline-title" className="mt-1 font-heading text-lg font-bold text-ink">Línea de tiempo</h2>
            <Timeline items={timeline} className="mt-5" density="compact" />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="summary-title">
            <div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-brand-800" aria-hidden="true" /><h2 id="summary-title" className="font-heading text-lg font-bold">Resumen</h2></div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Canal</dt><dd className="font-semibold">{orderTypeLabels[order.type]}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatCurrency(order.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Domicilio</dt><dd className="tabular-nums">{formatCurrency(order.deliveryFee)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-3 text-base"><dt className="font-semibold">Total</dt><dd className="font-heading font-bold tabular-nums">{formatCurrency(orderTotal(order.subtotal, order.deliveryFee))}</dd></div>
            </dl>
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="customer-title">
            <div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-brand-800" aria-hidden="true" /><h2 id="customer-title" className="font-heading text-lg font-bold">Cliente y asignación</h2></div>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-muted">Cliente</dt><dd className="mt-1 font-semibold">{order.customerName ?? 'No identificado'}</dd></div>
              {order.customerPhone ? <div><dt className="text-muted">Teléfono</dt><dd className="mt-1 font-semibold">{order.customerPhone}</dd></div> : null}
              <div><dt className="text-muted">Responsable</dt><dd className="mt-1 font-semibold">{order.assignedWaiter?.fullName ?? order.assignedRider?.fullName ?? 'Sin asignar'}</dd></div>
              {order.table ? <div><dt className="text-muted">Mesa</dt><dd className="mt-1 font-semibold">{order.table.label}</dd></div> : null}
            </dl>
          </section>

          <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="payment-title">
            <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-brand-800" aria-hidden="true" /><h2 id="payment-title" className="font-heading text-lg font-bold">Estado financiero</h2></div>
            <div className="mt-4"><StatusBadge status={payment.status} label={payment.label} /></div>
            <p className="mt-3 text-sm leading-6 text-muted">{payment.description}</p>
          </section>

          {order.type === 'DELIVERY' ? (
            <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="delivery-title">
              <div className="flex items-center gap-2"><Bike className="h-5 w-5 text-brand-800" aria-hidden="true" /><h2 id="delivery-title" className="font-heading text-lg font-bold">Domicilio</h2></div>
              <div className="mt-4"><StatusBadge status={order.deliveryWorkflowStatus ?? 'PENDING'} label={order.deliveryWorkflowStatus?.replaceAll('_', ' ') ?? 'Sin estado logístico'} /></div>
              <dl className="mt-3 space-y-3 text-sm">
                <div><dt className="text-muted">Dirección confirmada</dt><dd className="mt-1 font-semibold">{order.deliveryAddressNormalized ?? order.deliveryReference ?? 'No disponible'}</dd></div>
                {order.deliveryZoneLabel ? <div><dt className="text-muted">Zona</dt><dd className="mt-1 font-semibold">{order.deliveryZoneLabel}</dd></div> : null}
              </dl>
            </section>
          ) : null}

          <section className="rounded-2xl border border-line bg-canvas p-4" aria-label="Relaciones operativas">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock3 className="h-4 w-4" />Relaciones</p>
            <p className="mt-2 text-sm leading-6 text-muted">La conversación y los casos relacionados solo se muestran cuando el contrato canónico expone el vínculo. No se infieren por teléfono.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
