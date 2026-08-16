import { Activity, Send } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { formatDateTime } from '@/lib/format';

const DIRECTION_LABEL: Record<'INBOUND' | 'OUTBOUND' | 'INTERNAL', string> = {
  INBOUND: 'Entrante',
  OUTBOUND: 'Saliente',
  INTERNAL: 'Interno',
};

const DELIVERY_STATUS_LABEL: Record<'PENDING' | 'BLOCKED' | 'CANCELLED', string> = {
  PENDING: 'Pendiente',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
};

export function ActivityTimeline({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <div className="space-y-3" data-testid="sofia-customer360-activity-panel">
      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Línea de tiempo de interacciones</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Interacciones registradas por el backend, no editables desde este panel.</p>

        {customer.timeline.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<Activity className="h-5 w-5" />} title="Sin actividad" description="No hay interacciones registradas para este cliente." />
          </div>
        ) : (
          <ol className="mt-3 space-y-2.5">
            {customer.timeline.map((event) => (
              <li key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-ink">{event.kind}</p>
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">
                    {event.channel} · {DIRECTION_LABEL[event.direction]}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-5 text-stone-600">{event.summary}</p>
                <p className="mt-1 text-[11px] text-stone-600">{formatDateTime(event.occurredAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card data-testid="sofia-customer360-deliveries">
        <h3 className="text-[13.5px] font-extrabold text-ink">Entregas de campañas</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">
          Historial de intentos de entrega de campañas CRM. El envío real de WhatsApp permanece siempre bloqueado por diseño.
        </p>

        {customer.deliveries.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<Send className="h-5 w-5" />} title="Sin entregas" description="No hay entregas de campañas registradas para este cliente." />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.deliveries.map((delivery) => (
              <li key={delivery.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-ink">{delivery.recipientMasked}</p>
                  <StatusBadge tone={delivery.status === 'PENDING' ? 'pending' : 'blocked'} label={DELIVERY_STATUS_LABEL[delivery.status]} />
                </div>
                {delivery.blockedReason && <p className="mt-1 text-[11px] text-stone-600">Razón: {delivery.blockedReason}</p>}
                <p className="mt-1 text-[11px] text-stone-600">
                  {delivery.attemptedAt ? `Intentado ${formatDateTime(delivery.attemptedAt)}` : `Creado ${formatDateTime(delivery.createdAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
