'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Pager, QueryStateBoundary, StatusBadge } from '@/components/sofia';
import { ApiError } from '@/lib/api';
import { useSofiaCrmRecordInteraction, useSofiaCrmUnifiedTimeline } from '@/features/sofia/queries';
import type { SofiaCrmUnifiedTimelineEvent } from '@/features/sofia/contracts';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 15;

/**
 * ORDER_CHECKOUT/PAYMENT_INTENT/DELIVERY_EVENT ya son dominio de
 * POS/Domicilios/Caja — el backend solo los correlaciona aquí. Por el
 * principio de no-duplicación, se renderizan SOLO como chip (tipo +
 * estado + id truncado), nunca con el detalle completo de `facts`.
 */
const EXTERNAL_DOMAIN_TYPES = new Set<SofiaCrmUnifiedTimelineEvent['type']>(['ORDER_CHECKOUT', 'PAYMENT_INTENT', 'DELIVERY_EVENT']);

const EVENT_TYPE_LABEL: Record<SofiaCrmUnifiedTimelineEvent['type'], string> = {
  INTERACTION: 'Interacción',
  CONVERSATION: 'Conversación',
  ORDER_CHECKOUT: 'Pedido (POS)',
  PAYMENT_INTENT: 'Pago',
  SERVICE_CASE: 'Caso de servicio',
  CRM_LEAD: 'Lead',
  CRM_TASK: 'Tarea',
  CRM_NOTE: 'Nota',
  DELIVERY_EVENT: 'Domicilio',
};

const INTERACTION_KIND_OPTIONS = ['CALL', 'VISIT', 'FOLLOW_UP', 'OTHER'] as const;
const INTERACTION_KIND_LABEL: Record<string, string> = {
  CALL: 'Llamada',
  VISIT: 'Visita',
  FOLLOW_UP: 'Seguimiento',
  OTHER: 'Otro',
};

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE: 'Llamada',
  IN_PERSON: 'Presencial',
  SYSTEM: 'Sistema',
};

const DIRECTION_LABEL: Record<string, string> = {
  INBOUND: 'Entrante',
  OUTBOUND: 'Saliente',
  INTERNAL: 'Interno',
};

function truncateId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

function factString(facts: Record<string, unknown>, key: string): string | undefined {
  const value = facts[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function EventRow({ event }: { event: SofiaCrmUnifiedTimelineEvent }) {
  const status = factString(event.facts, 'status');

  if (EXTERNAL_DOMAIN_TYPES.has(event.type)) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-3.5 py-2.5" data-testid="sofia-customer360-activity-external-event">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600">
          {EVENT_TYPE_LABEL[event.type]}
          {status ? ` · ${status}` : ''} · #{truncateId(event.id)}
        </span>
        <span className="text-[11px] text-stone-500">{formatDateTime(event.occurredAt)}</span>
      </li>
    );
  }

  const summary =
    factString(event.facts, 'summary') ??
    factString(event.facts, 'sanitizedSummary') ??
    factString(event.facts, 'sanitizedBody') ??
    factString(event.facts, 'title');
  const channel = factString(event.facts, 'channel');
  const direction = factString(event.facts, 'direction');

  return (
    <li className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5" data-testid="sofia-customer360-activity-own-event">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-ink">{EVENT_TYPE_LABEL[event.type]}</p>
        {status && <StatusBadge tone="read_only" label={status} />}
      </div>
      {summary && <p className="mt-1 text-[12px] leading-5 text-stone-600">{summary}</p>}
      {(channel || direction) && (
        <p className="mt-1 text-[11px] font-semibold text-stone-600">
          {channel ? CHANNEL_LABEL[channel] ?? channel : ''}
          {channel && direction ? ' · ' : ''}
          {direction ? DIRECTION_LABEL[direction] ?? direction : ''}
        </p>
      )}
      <p className="mt-1 text-[11px] text-stone-600">{formatDateTime(event.occurredAt)}</p>
    </li>
  );
}

export function ActivityPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<string>(INTERACTION_KIND_OPTIONS[0]);
  const [channel, setChannel] = useState<'WHATSAPP' | 'PHONE' | 'IN_PERSON' | 'SYSTEM'>('PHONE');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND' | 'INTERNAL'>('OUTBOUND');
  const [summary, setSummary] = useState('');

  const queryClient = useQueryClient();
  const timeline = useSofiaCrmUnifiedTimeline(customerId, { page, limit: PAGE_SIZE });
  const recordInteraction = useSofiaCrmRecordInteraction();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = summary.trim();
    if (!trimmed) return;

    recordInteraction.mutate(
      { customerId, kind, channel, direction, summary: trimmed },
      {
        onSuccess: () => {
          toast.success('Interacción registrada');
          setSummary('');
          queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'customers', customerId, 'unified-timeline'] });
        },
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'No se pudo registrar la interacción.'),
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="sofia-customer360-activity-panel">
      <Card data-testid="sofia-customer360-activity-record-form">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13.5px] font-extrabold text-ink">Registrar interacción manual</h3>
            <p className="mt-0.5 text-[12px] text-stone-600">Ej: una llamada telefónica o visita, no capturada automáticamente por SOFIA.</p>
          </div>
          <PhoneCall className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
        </div>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Tipo</label>
              <Select value={kind} onChange={(event) => setKind(event.target.value)} data-testid="sofia-customer360-activity-kind">
                {INTERACTION_KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {INTERACTION_KIND_LABEL[option]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Canal</label>
              <Select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)} data-testid="sofia-customer360-activity-channel">
                <option value="PHONE">Llamada</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="IN_PERSON">Presencial</option>
                <option value="SYSTEM">Sistema</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Dirección</label>
              <Select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)} data-testid="sofia-customer360-activity-direction">
                <option value="OUTBOUND">Saliente</option>
                <option value="INBOUND">Entrante</option>
                <option value="INTERNAL">Interno</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Resumen</label>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Qué se habló o gestionó con el cliente…"
              className="min-h-[4.5rem]"
              data-testid="sofia-customer360-activity-summary"
            />
          </div>

          {recordInteraction.isError && (
            <p className="text-[12px] font-semibold text-red-700" role="alert">
              {recordInteraction.error instanceof ApiError ? recordInteraction.error.message : 'No se pudo registrar la interacción.'}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!summary.trim() || recordInteraction.isPending} data-testid="sofia-customer360-activity-submit">
              {recordInteraction.isPending ? 'Guardando…' : 'Registrar interacción'}
            </Button>
          </div>
        </form>
      </Card>

      <Card data-testid="sofia-customer360-activity-timeline">
        <h3 className="text-[13.5px] font-extrabold text-ink">Línea de tiempo unificada</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">
          Actividad correlacionada del cliente. Pedidos, pagos y domicilios se muestran solo como referencia — su detalle vive en POS, Caja y Domicilios.
        </p>

        <QueryStateBoundary
          isLoading={timeline.isLoading}
          isError={timeline.isError}
          error={timeline.error}
          data={timeline.data}
          loadingLabel="Cargando actividad del cliente…"
          errorTitle="No se pudo cargar la línea de tiempo"
        >
          {(result) => (
            <>
              {result.readModel.potentiallyTruncated && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5" role="status">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                  <p className="text-[11.5px] leading-5 text-amber-800">
                    Este resultado puede estar acotado a {result.readModel.boundedPerSource} eventos por fuente — puede no reflejar el historial completo.
                  </p>
                </div>
              )}

              {result.data.length === 0 ? (
                <div className="mt-3">
                  <EmptyState icon={<Activity className="h-5 w-5" aria-hidden="true" />} title="Sin actividad" description="No hay eventos registrados para este cliente." />
                </div>
              ) : (
                <ol className="mt-3 space-y-2.5">
                  {result.data.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ol>
              )}

              <div className="mt-3">
                <Pager
                  page={result.pagination.page}
                  limit={result.pagination.limit}
                  total={result.pagination.total}
                  pages={result.pagination.pages}
                  itemsLabel="eventos"
                  onPrev={() => setPage((current) => Math.max(1, current - 1))}
                  onNext={() => setPage((current) => Math.min(Math.max(1, result.pagination.pages), current + 1))}
                  data-testid="sofia-customer360-activity-pagination"
                />
              </div>
            </>
          )}
        </QueryStateBoundary>
      </Card>
    </div>
  );
}

