'use client';

import { FormEvent, useState } from 'react';
import { Activity, AlertTriangle, CreditCard, MessageSquareText, NotebookPen, PackageCheck, Truck, UserRoundSearch } from 'lucide-react';
import { QueryState, Timeline, type TimelineItem } from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { CrmTimelineEvent } from './contracts';
import { useCrmUnifiedTimeline } from './queries';

const eventLabels: Record<CrmTimelineEvent['type'], string> = {
  INTERACTION: 'Interacción registrada',
  CONVERSATION: 'Conversación SOFIA',
  ORDER_CHECKOUT: 'Checkout comercial',
  PAYMENT_INTENT: 'Intento de pago',
  SERVICE_CASE: 'Caso de servicio',
  CRM_LEAD: 'Lead comercial',
  CRM_TASK: 'Trabajo CRM',
  CRM_NOTE: 'Nota interna',
  DELIVERY_EVENT: 'Evento de entrega',
};

function eventIcon(type: CrmTimelineEvent['type']) {
  if (type === 'PAYMENT_INTENT') return <CreditCard className="h-4 w-4" />;
  if (type === 'CONVERSATION' || type === 'INTERACTION') return <MessageSquareText className="h-4 w-4" />;
  if (type === 'DELIVERY_EVENT') return <Truck className="h-4 w-4" />;
  if (type === 'CRM_NOTE') return <NotebookPen className="h-4 w-4" />;
  if (type === 'ORDER_CHECKOUT') return <PackageCheck className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
}

function safeDescription(event: CrmTimelineEvent) {
  const facts = event.facts;
  const summary = typeof facts.summary === 'string' ? facts.summary : typeof facts.body === 'string' ? facts.body : typeof facts.title === 'string' ? facts.title : null;
  if (summary) return summary;
  const status = typeof facts.status === 'string' ? facts.status.replaceAll('_', ' ') : null;
  const stage = typeof facts.stage === 'string' ? facts.stage : null;
  const total = typeof facts.total === 'string' ? formatCurrency(facts.total) : typeof facts.amount === 'string' ? formatCurrency(facts.amount) : null;
  return [status, stage, total].filter(Boolean).join(' · ') || 'Evento registrado sin detalle adicional.';
}

export function ActivityView() {
  const [input, setInput] = useState('');
  const [customerId, setCustomerId] = useState('');
  const timeline = useCrmUnifiedTimeline(customerId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCustomerId(input.trim());
  }

  const items: TimelineItem[] = (timeline.data?.data ?? []).map((event) => ({
    id: `${event.type}:${event.id}`,
    title: eventLabels[event.type],
    timestamp: formatDateTime(event.occurredAt),
    description: safeDescription(event),
    icon: eventIcon(event.type),
    tone: event.type === 'PAYMENT_INTENT' && event.facts.status === 'UNKNOWN_RESULT' ? 'warning' : event.type === 'SERVICE_CASE' ? 'warning' : 'info',
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-brand-800"><UserRoundSearch className="h-5 w-5" /></span><div><h2 className="font-heading text-lg font-bold text-ink">Timeline unificado por cliente</h2><p className="mt-1 text-sm leading-6 text-muted">Consulta el identificador canónico desde Customer 360. La vista agrega hechos sanitizados sin duplicar su autoridad.</p></div></div>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submit} role="search">
          <label className="min-w-0 flex-1"><span className="sr-only">Identificador canónico del cliente</span><Input value={input} onChange={(event) => setInput(event.target.value)} minLength={8} maxLength={64} placeholder="Identificador del cliente" autoComplete="off" /></label>
          <Button type="submit" disabled={input.trim().length < 8}>Consultar actividad</Button>
        </form>
      </section>

      {!customerId ? <QueryState status="empty" title="Selecciona un cliente" description="La actividad se consulta por identidad canónica para evitar mezclar historiales." /> : timeline.isPending ? <QueryState status="loading" title="Construyendo timeline" /> : timeline.error ? <QueryState status="error" onRetry={() => void timeline.refetch()} /> : items.length === 0 ? <QueryState status="empty" title="Sin actividad registrada" description="Este cliente todavía no tiene hechos en las fuentes CRM autorizadas." /> : (
        <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
          {timeline.data?.readModel.potentiallyTruncated ? <p className="mb-4 flex items-center gap-2 rounded-xl border border-signal-warning/30 bg-signal-warning/10 p-3 text-sm text-signal-warning" role="status"><AlertTriangle className="h-4 w-4" />La vista alcanzó su límite seguro por fuente. Refina la consulta desde Customer 360.</p> : null}
          <Timeline items={items} label="Actividad unificada del cliente" density="compact" />
        </section>
      )}
    </div>
  );
}
