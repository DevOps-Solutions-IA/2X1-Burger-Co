'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { getOperationalOrderDisplayCode } from '@/lib/order-display';
import { getOrderTypeVisual, orderStatusLabels } from './pos.helpers';
import type { ActiveOrder, OrderStatus } from './pos.types';

const sofiaPaymentStatusLabels: Record<string, string> = {
  UNSELECTED: 'Pago sin seleccionar',
  CASH_ON_DELIVERY: 'Efectivo contra entrega',
  PENDING_MANUAL_VERIFICATION: 'Nequi por verificar',
  PENDING_ONLINE_PAYMENT: 'Online pendiente',
  PAID: 'Pagado',
  FAILED: 'Pago fallido',
  MANUAL_REVIEW: 'Revisión manual',
  CANCELLED: 'Pago cancelado',
};

function sofiaPaymentSummary(order: ActiveOrder) {
  const payment = order.whatsappDeliveryOrder;
  if (!payment) return 'Pago sin seleccionar';
  const statusLabel = sofiaPaymentStatusLabels[payment.paymentStatus] ?? payment.paymentStatus;
  const methodLabel =
    payment.paymentMethod === 'CASH'
      ? 'Efectivo'
      : payment.paymentMethod === 'NEQUI_MANUAL'
        ? 'Nequi manual'
        : payment.paymentMethod === 'ONLINE'
          ? 'Online futuro'
          : 'Sin método';
  return `${statusLabel} · ${methodLabel}`;
}

export function PosActiveOrdersPanel({
  orders,
  isLoading,
  activeOrderId,
  onSelectOrder,
}: {
  orders: ActiveOrder[] | undefined;
  isLoading: boolean;
  activeOrderId: string | null;
  onSelectOrder: (order: ActiveOrder) => void;
}) {
  return (
    <Card data-testid="pos-open-orders">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold lg:text-[1.12rem]">Pedidos abiertos</h2>
          <p className="mt-1 text-[13px] leading-6 text-stone-500">
            {Number(orders?.length ?? 0) > 10
              ? 'Las comandas siguen disponibles con scroll interno.'
              : 'Retoma o cobra una comanda sin perder el contexto del POS.'}
          </p>
        </div>
        <Badge tone="default">{orders?.length ?? 0}</Badge>
      </div>

      <div className="hide-scrollbar mt-6 max-h-[54rem] overflow-y-auto pr-1">
        <div className="grid gap-3 lg:grid-cols-2">
          {isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-32 rounded-[1.5rem]" />
              ))
            : null}

          {!isLoading && !orders?.length ? (
            <div className="lg:col-span-2">
              <EmptyState
                title="No hay pedidos abiertos ahora."
                description="Aquí aparecerán para retomarlas o cobrarlas."
              />
            </div>
          ) : null}

          {orders?.map((order) => (
            (() => {
              const waiterName = order.waiterNameSnapshot ?? order.assignedWaiter?.fullName ?? null;
              const isSofiaOrder =
                order.whatsappDeliveryOrder?.source === 'WHATSAPP_SOFIA' ||
                order.whatsappDeliveryOrder?.createdByAgentNameSnapshot === 'Sofía';
              return (
            <button
              key={order.id}
              type="button"
              className={`flex min-h-[9.5rem] min-w-0 flex-col rounded-[1.5rem] border p-4 text-left transition ${
                activeOrderId === order.id
                  ? isSofiaOrder
                    ? 'border-violet-400 bg-violet-50 shadow-[0_8px_24px_rgba(124,58,237,0.12)]'
                    : 'border-brand-400 bg-brand-50 shadow-[0_8px_24px_rgba(255,159,28,0.12)]'
                  : isSofiaOrder
                    ? 'border-violet-200 bg-violet-50/50 hover:border-violet-300 hover:shadow-[0_8px_24px_rgba(124,58,237,0.10)]'
                    : 'border-stone-200 bg-white hover:border-brand-300 hover:shadow-soft'
              }`}
              onClick={() => onSelectOrder(order)}
              data-testid={`order-card-${order.number.toLowerCase()}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[15px] font-bold text-ink">{getOperationalOrderDisplayCode(order.type)}</p>
                    {isSofiaOrder ? (
                      <span
                        className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-violet-800"
                        data-testid="pos-sofia-order-chip"
                      >
                        Sofía
                      </span>
                    ) : null}
                    <span className={getOrderTypeVisual(order.type).pillClass}>
                      {getOrderTypeVisual(order.type).label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[13px] font-bold text-ink">
                    {order.type === 'DINE_IN'
                      ? (order.customerName ? `${order.table?.label ?? 'Mesa'} · ${order.customerName}` : order.table?.label ?? 'Mesa sin asignar')
                      : order.type === 'DELIVERY'
                        ? order.customerName ?? order.deliveryReference ?? 'Domicilio'
                        : order.customerName ?? 'Mostrador'}
                  </p>
                  {order.type === 'DINE_IN' ? (
                    <p className="mt-1 truncate text-[11px] font-semibold text-stone-500">
                      Mesero: {waiterName ?? 'Sin asignar'}
                    </p>
                  ) : null}
                  {isSofiaOrder ? (
                    <p className="mt-1 truncate text-[11px] font-semibold text-violet-700" data-testid="pos-sofia-order-origin">
                      Origen: Sofía · {sofiaPaymentSummary(order)}
                      {order.whatsappDeliveryOrder?.orderReference ? ` · ${order.whatsappDeliveryOrder.orderReference}` : ''}
                    </p>
                  ) : null}
                </div>
                <Badge tone={order.status === 'PAYMENT_PENDING' ? 'success' : 'neutral'} className="shrink-0">
                  {order.status === 'PAYMENT_PENDING'
                    ? 'Cobrar'
                    : orderStatusLabels[order.status as OrderStatus] ?? order.status}
                </Badge>
              </div>
              <div className="mt-auto grid gap-2 pt-4 text-[12px] text-stone-500 sm:grid-cols-[1fr_auto] sm:items-end">
                <span className="min-w-0 truncate">{formatDateTime(order.updatedAt)}</span>
                <span className="numeric-tabular text-[15px] font-bold text-ink">{formatCurrency(order.subtotal)}</span>
              </div>
            </button>
              );
            })()
          ))}
        </div>
      </div>
    </Card>
  );
}
