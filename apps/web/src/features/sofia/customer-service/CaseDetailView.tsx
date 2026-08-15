'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, QueryStateBoundary } from '@/components/sofia/workspace';
import { useSofiaCustomerServiceCase, useSofiaCustomerServiceTransition } from '@/features/sofia/queries';
import type { SofiaCustomerServiceCaseDetail, SofiaCustomerServiceCaseEvent } from '@/features/sofia/contracts';
import { customerDisplayName, humanizeCrmCode } from '@/features/sofia/crm-display';
import { ApiError } from '@/lib/api';
import {
  CUSTOMER_SERVICE_STATUS_LABEL,
  customerServiceStatusLabel,
  customerServiceStatusTone,
  nextCustomerServiceStatus,
} from './constants';

export function CaseDetailView({ caseId }: { caseId: string }) {
  const serviceCase = useSofiaCustomerServiceCase(caseId);

  return (
    <QueryStateBoundary
      isLoading={serviceCase.isLoading}
      isError={serviceCase.isError}
      error={serviceCase.error}
      data={serviceCase.data}
      loadingLabel="Cargando caso de servicio al cliente…"
      errorTitle="No se pudo cargar el caso"
      data-testid="sofia-customer-service-case"
    >
      {(data) => <CaseDetailContent data={data} />}
    </QueryStateBoundary>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-600">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}

function CaseDetailContent({ data }: { data: SofiaCustomerServiceCaseDetail }) {
  return (
    <div className="space-y-4" data-testid="sofia-customer-service-detail-view">
      <Card data-testid="sofia-customer-service-summary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Caso #{data.id.slice(0, 8)}</p>
            <h2 className="text-[16px] font-semibold text-ink">{humanizeCrmCode(data.category)}</h2>
          </div>
          <StatusBadge tone={customerServiceStatusTone(data.status)} label={customerServiceStatusLabel(data.status)} />
        </div>

        <p className="mt-2.5 text-[12.5px] leading-5.5 text-stone-700">{data.sanitizedSummary || 'Sin resumen registrado.'}</p>

        <dl className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
          <DetailField label="Origen" value={humanizeCrmCode(data.source)} />
          <DetailField
            label="Cliente"
            value={data.customer ? customerDisplayName(data.customer.displayName) : 'Sin cliente vinculado'}
          />
          <DetailField
            label="Asignado a"
            value={
              data.assignedActor
                ? data.assignedActor.fullName || data.assignedActor.accessName || data.assignedActor.id
                : 'Sin asignar'
            }
          />
          <DetailField
            label="Código de resolución"
            value={data.resolutionCode ? humanizeCrmCode(data.resolutionCode) : 'N/A'}
          />
          <DetailField label="Creado" value={new Date(data.createdAt).toLocaleString('es-CO')} />
          <DetailField label="Actualizado" value={new Date(data.updatedAt).toLocaleString('es-CO')} />
          {data.resolvedAt && <DetailField label="Resuelto" value={new Date(data.resolvedAt).toLocaleString('es-CO')} />}
          {data.closedAt && <DetailField label="Cerrado" value={new Date(data.closedAt).toLocaleString('es-CO')} />}
        </dl>

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {data.conversationId && <Badge tone="neutral">Conversación vinculada</Badge>}
          {data.orderCheckoutId && <Badge tone="neutral">Checkout vinculado</Badge>}
          {data.orderTicketId && <Badge tone="neutral">Ticket vinculado</Badge>}
          {data.paymentIntentId && <Badge tone="neutral">Pago vinculado</Badge>}
          {data.deliveryIssueId && <Badge tone="neutral">Incidencia de domicilio vinculada</Badge>}
        </div>
      </Card>

      <CorrelatedDataPanel data={data} />

      <TransitionPanel data={data} />

      <EventsTimeline events={data.events} />
    </div>
  );
}

function CorrelatedDataPanel({ data }: { data: SofiaCustomerServiceCaseDetail }) {
  const entries: Array<{ label: string; value: Record<string, unknown> }> = [];
  if (data.orderCheckout) entries.push({ label: 'Checkout', value: data.orderCheckout });
  if (data.orderTicket) entries.push({ label: 'Ticket', value: data.orderTicket });
  if (data.paymentIntent) entries.push({ label: 'Intento de pago', value: data.paymentIntent });
  if (data.deliveryIssue) entries.push({ label: 'Incidencia de domicilio', value: data.deliveryIssue });

  if (entries.length === 0) return null;

  return (
    <Card data-testid="sofia-customer-service-correlated-data">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Datos correlacionados</p>
      <h2 className="text-[15px] font-semibold text-ink">Entidades del dominio vinculadas</h2>
      <p className="mt-1 text-[11.5px] font-medium text-stone-600">
        Datos crudos devueltos por el backend para este caso. Se muestran colapsados por precaución.
      </p>
      <div className="mt-3 space-y-2">
        {entries.map((entry) => (
          <details key={entry.label} className="rounded-[0.9rem] border border-stone-200 bg-stone-50 px-3 py-2.5">
            <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">{entry.label}</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-stone-700">
              {JSON.stringify(entry.value, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </Card>
  );
}

function TransitionPanel({ data }: { data: SofiaCustomerServiceCaseDetail }) {
  const transition = useSofiaCustomerServiceTransition();
  const [reasonCode, setReasonCode] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');
  const next = nextCustomerServiceStatus(data.status);

  useEffect(() => {
    setReasonCode('');
    setResolutionCode('');
    transition.reset();
    // Reinicia el formulario y el estado de la mutación cuando cambia el caso o su estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id, data.status]);

  if (!next) {
    return (
      <Card data-testid="sofia-customer-service-transition">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Transición de estado</p>
        <p className="mt-2 text-[12.5px] font-medium text-stone-700">
          {data.status === 'CLOSED'
            ? 'Este caso está cerrado. No hay transiciones disponibles.'
            : 'No hay una transición siguiente definida para este estado.'}
        </p>
      </Card>
    );
  }

  const requiresResolutionCode = next === 'RESOLVED';
  const canSubmit = reasonCode.trim().length > 0 && (!requiresResolutionCode || resolutionCode.trim().length > 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || transition.isPending || !next) return;
    transition.mutate({
      caseId: data.id,
      expectedVersion: data.version,
      fromStatus: data.status,
      toStatus: next,
      idempotencyKey: crypto.randomUUID(),
      reasonCode: reasonCode.trim(),
      resolutionCode: requiresResolutionCode ? resolutionCode.trim() : undefined,
    });
  }

  return (
    <Card data-testid="sofia-customer-service-transition">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Transición de estado — acción del operador</p>
      <h2 className="text-[15px] font-semibold text-ink">Marcar como {CUSTOMER_SERVICE_STATUS_LABEL[next]}</h2>
      <p className="mt-1 text-[11.5px] font-medium text-stone-600">
        Esta transición la ejecuta el operador humano autenticado desde el panel admin. Sofía no puede aplicarla de forma
        autónoma.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-2.5">
        <div>
          <label htmlFor="sofia-cs-reason-code" className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-600">
            Código de motivo (obligatorio)
          </label>
          <div className="mt-1">
            <Input
              id="sofia-cs-reason-code"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              placeholder="Ej. OPERATOR_REVIEW_COMPLETE"
              disabled={transition.isPending}
              data-testid="sofia-customer-service-reason-code-input"
            />
          </div>
        </div>

        {requiresResolutionCode && (
          <div>
            <label htmlFor="sofia-cs-resolution-code" className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-600">
              Código de resolución (obligatorio para Resuelto)
            </label>
            <div className="mt-1">
              <Input
                id="sofia-cs-resolution-code"
                value={resolutionCode}
                onChange={(event) => setResolutionCode(event.target.value)}
                placeholder="Ej. REFUND_ISSUED"
                disabled={transition.isPending}
                data-testid="sofia-customer-service-resolution-code-input"
              />
            </div>
          </div>
        )}

        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit || transition.isPending}
          data-testid="sofia-customer-service-transition-submit"
        >
          {transition.isPending ? 'Aplicando transición…' : `Confirmar → ${CUSTOMER_SERVICE_STATUS_LABEL[next]}`}
        </Button>

        {transition.isError && (
          <p
            className="flex items-center gap-1.5 text-[12px] font-semibold text-red-700"
            role="alert"
            data-testid="sofia-customer-service-transition-error"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {transition.error instanceof ApiError ? transition.error.message : 'No se pudo aplicar la transición.'}
          </p>
        )}

        {transition.isSuccess && (
          <p
            className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"
            role="status"
            data-testid="sofia-customer-service-transition-success"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Transición aplicada
            {transition.data?.state === 'DETERMINISTIC_REPLAY' ? ' (reintento idempotente detectado).' : '.'}
          </p>
        )}
      </form>
    </Card>
  );
}

function EventsTimeline({ events }: { events: SofiaCustomerServiceCaseEvent[] }) {
  const sorted = [...events].sort((a, b) => a.version - b.version);

  return (
    <Card data-testid="sofia-customer-service-events">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Auditoría</p>
      <h2 className="text-[15px] font-semibold text-ink">Línea de tiempo del caso</h2>

      {sorted.length > 0 ? (
        <div className="mt-3 space-y-2">
          {sorted.map((event) => (
            <div
              key={event.id}
              className="rounded-[0.9rem] bg-stone-50 px-3 py-2.5"
              data-testid={`sofia-customer-service-event-${event.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-ink">
                  {event.fromStatus ? `${customerServiceStatusLabel(event.fromStatus)} → ` : ''}
                  {customerServiceStatusLabel(event.toStatus)}
                </p>
                <span className="shrink-0 text-[10.5px] font-medium text-stone-600">
                  {new Date(event.createdAt).toLocaleString('es-CO')}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] font-medium text-stone-600">
                {humanizeCrmCode(event.action)}
                {event.reasonCode ? ` · ${humanizeCrmCode(event.reasonCode)}` : ''}
              </p>
              {event.actorId && (
                <p className="mt-0.5 text-[10.5px] font-medium text-stone-600">Operador: {event.actorId.slice(0, 8)}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState title="Sin eventos" description="Todavía no hay eventos registrados para este caso." />
        </div>
      )}
    </Card>
  );
}
