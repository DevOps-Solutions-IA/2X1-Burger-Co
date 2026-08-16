'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge, QueryStateBoundary } from '@/components/sofia';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import {
  useSofiaCustomerServiceCases,
  useSofiaCustomerServiceCase,
  useSofiaCustomerServiceTransition,
} from '@/features/sofia/queries';
import type { SofiaCustomerServiceCaseDetail, SofiaCustomerServiceCaseSummary } from '@/features/sofia/contracts';
import { caseStatusLabel, formatCaseCategory, nextCaseStatus, toneFromCaseStatus, truncateReferenceId } from './labels';
import { Pager } from './Pager';

const PAGE_SIZE = 10;
const CASE_STATUS_OPTIONS = ['OPEN', 'HUMAN_REQUIRED', 'HUMAN_TAKEN', 'RESOLVED', 'CLOSED'] as const;

function ReferenceChips({ item }: { item: Pick<SofiaCustomerServiceCaseSummary, 'orderCheckoutId' | 'orderTicketId' | 'paymentIntentId' | 'deliveryIssueId'> }) {
  const refs: Array<{ label: string; id: string }> = [];
  if (item.orderCheckoutId) refs.push({ label: 'Checkout', id: item.orderCheckoutId });
  if (item.orderTicketId) refs.push({ label: 'Ticket', id: item.orderTicketId });
  if (item.paymentIntentId) refs.push({ label: 'Pago', id: item.paymentIntentId });
  if (item.deliveryIssueId) refs.push({ label: 'Domicilio', id: item.deliveryIssueId });

  if (refs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((ref) => (
        <Badge key={`${ref.label}-${ref.id}`} tone="neutral">
          {ref.label}: {truncateReferenceId(ref.id)}
        </Badge>
      ))}
    </div>
  );
}

export function CasesPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useSofiaCustomerServiceCases({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    category: category.trim() || undefined,
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]" data-testid="sofia-validation-cases-panel">
      <Card data-testid="sofia-validation-cases-list-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem]">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600" htmlFor="sofia-validation-cases-filter-status">
              Estado
            </label>
            <Select
              id="sofia-validation-cases-filter-status"
              className="mt-1"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              data-testid="sofia-validation-cases-filter-status"
            >
              <option value="">Todos</option>
              {CASE_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {caseStatusLabel(option)}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[11rem]">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600" htmlFor="sofia-validation-cases-filter-category">
              Categoría
            </label>
            <Input
              id="sofia-validation-cases-filter-category"
              className="mt-1"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              placeholder="ej. DELIVERY_ISSUE"
              data-testid="sofia-validation-cases-filter-category"
            />
          </div>
        </div>

        <div className="mt-4">
          <QueryStateBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            data={query.data}
            loadingLabel="Cargando casos de servicio al cliente…"
            errorTitle="No se pudieron cargar los casos"
            data-testid="sofia-validation-cases-list"
          >
            {(data) =>
              data.items.length === 0 ? (
                <div data-testid="sofia-validation-cases-empty">
                  <EmptyState
                    title="No hay casos con estos filtros"
                    description="Cuando SOFIA escale una conversación a un humano, el caso aparecerá aquí para su gestión."
                  />
                </div>
              ) : (
                <>
                  <ul className="space-y-2" data-testid="sofia-validation-cases-rows">
                    {data.items.map((item) => {
                      const isActive = item.id === selectedId;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            className={
                              'flex w-full flex-col gap-1.5 rounded-[1.1rem] border px-3.5 py-3 text-left transition-colors ' +
                              (isActive
                                ? 'border-brand-400 bg-brand-50/70 shadow-soft'
                                : 'border-stone-200 bg-white hover:border-brand-200 hover:bg-brand-50/40')
                            }
                            data-testid={`sofia-validation-case-row-${item.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-semibold text-ink">{formatCaseCategory(item.category)}</p>
                                <p className="mt-0.5 text-[12px] text-stone-600">
                                  {item.customer?.displayName ?? 'Sin cliente identificado'} · Origen: {item.source}
                                </p>
                              </div>
                              <StatusBadge tone={toneFromCaseStatus(item.status)} label={caseStatusLabel(item.status)} />
                            </div>
                            {item.sanitizedSummary && <p className="truncate text-[12px] text-stone-600">{item.sanitizedSummary}</p>}
                            <ReferenceChips item={item} />
                            <p className="text-[11px] text-stone-600">{formatDateTime(item.updatedAt)}</p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} data-testid="sofia-validation-cases-pager" />
                </>
              )
            }
          </QueryStateBoundary>
        </div>
      </Card>

      {selectedId ? (
        <CaseDetail caseId={selectedId} onClosed={() => setSelectedId(null)} />
      ) : (
        <Card data-testid="sofia-validation-case-detail-placeholder">
          <EmptyState title="Ningún caso seleccionado" description="Elige un caso de la lista para ver su línea de tiempo y transicionarlo al siguiente estado." />
        </Card>
      )}
    </div>
  );
}

function CaseDetail({ caseId, onClosed }: { caseId: string; onClosed: () => void }) {
  const detailQuery = useSofiaCustomerServiceCase(caseId);
  const transition = useSofiaCustomerServiceTransition();

  const [reasonCode, setReasonCode] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');

  function handleTransition(caseData: SofiaCustomerServiceCaseDetail, target: string) {
    if (!reasonCode.trim()) return;
    if (target === 'RESOLVED' && !resolutionCode.trim()) return;

    transition.mutate(
      {
        caseId: caseData.id,
        expectedVersion: caseData.version,
        fromStatus: caseData.status,
        toStatus: target,
        idempotencyKey: crypto.randomUUID(),
        reasonCode: reasonCode.trim(),
        resolutionCode: target === 'RESOLVED' ? resolutionCode.trim() : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Caso movido a «${caseStatusLabel(target)}»`);
          setReasonCode('');
          setResolutionCode('');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo transicionar el caso.'),
      },
    );
  }

  return (
    <Card data-testid="sofia-validation-case-detail">
      <QueryStateBoundary
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        error={detailQuery.error}
        data={detailQuery.data}
        loadingLabel="Cargando detalle del caso…"
        errorTitle="No se pudo cargar el caso"
      >
        {(caseData) => {
          const next = nextCaseStatus(caseData.status);
          return (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">Caso</p>
                  <h2 className="mt-0.5 truncate text-[15px] font-bold text-ink">{formatCaseCategory(caseData.category)}</h2>
                </div>
                <button type="button" onClick={onClosed} className="text-[11px] font-semibold text-stone-600 hover:text-ink" data-testid="sofia-validation-case-detail-close">
                  Cerrar
                </button>
              </div>

              <StatusBadge tone={toneFromCaseStatus(caseData.status)} label={caseStatusLabel(caseData.status)} />

              {caseData.sanitizedSummary && <p className="text-[12.5px] text-stone-700">{caseData.sanitizedSummary}</p>}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <DetailField label="Cliente" value={caseData.customer?.displayName ?? 'Sin identificar'} />
                <DetailField label="Origen" value={caseData.source} />
                <DetailField label="Asignado a" value={caseData.assignedActor?.fullName ?? 'Sin asignar'} />
                <DetailField label="Versión" value={String(caseData.version)} />
                {caseData.resolutionCode && <DetailField label="Código de resolución" value={caseData.resolutionCode} />}
                <DetailField label="Actualizado" value={formatDateTime(caseData.updatedAt)} />
              </dl>

              <ReferenceChips item={caseData} />

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600">Línea de tiempo</p>
                {caseData.events.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-stone-600">Sin eventos registrados todavía.</p>
                ) : (
                  <ol className="mt-1.5 space-y-1.5" data-testid="sofia-validation-case-timeline">
                    {caseData.events.map((event) => (
                      <li key={event.id} className="rounded-[0.9rem] border border-stone-200 bg-white px-3 py-2 text-[12px]">
                        <p className="font-semibold text-ink">
                          {event.action}
                          {event.fromStatus ? ` · ${caseStatusLabel(event.fromStatus)} → ${caseStatusLabel(event.toStatus)}` : ` · ${caseStatusLabel(event.toStatus)}`}
                        </p>
                        {event.reasonCode && <p className="mt-0.5 text-stone-600">Motivo: {event.reasonCode}</p>}
                        <p className="mt-0.5 text-stone-600">{formatDateTime(event.createdAt)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {next ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleTransition(caseData, next);
                  }}
                  className="space-y-2 border-t border-stone-200 pt-4"
                  data-testid="sofia-validation-case-transition-form"
                >
                  <p className="text-[12px] font-semibold text-ink">Mover a «{caseStatusLabel(next)}»</p>
                  <Input
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value)}
                    placeholder="reasonCode, ej. OPERATOR_TOOK_CASE"
                    data-testid="sofia-validation-case-transition-reason"
                  />
                  {next === 'RESOLVED' && (
                    <Input
                      value={resolutionCode}
                      onChange={(event) => setResolutionCode(event.target.value)}
                      placeholder="resolutionCode, ej. RESOLVED_REFUND_ISSUED"
                      data-testid="sofia-validation-case-transition-resolution"
                    />
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    disabled={transition.isPending || !reasonCode.trim() || (next === 'RESOLVED' && !resolutionCode.trim())}
                    data-testid="sofia-validation-case-transition-submit"
                  >
                    {transition.isPending ? 'Moviendo…' : `Mover a ${caseStatusLabel(next)}`}
                  </Button>
                </form>
              ) : (
                <p className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-600" data-testid="sofia-validation-case-not-actionable">
                  Este caso está cerrado y no admite más transiciones.
                </p>
              )}
            </div>
          );
        }}
      </QueryStateBoundary>
    </Card>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-600">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}
