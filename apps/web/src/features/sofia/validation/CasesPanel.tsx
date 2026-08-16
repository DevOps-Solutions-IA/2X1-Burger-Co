'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, ListFilter, X } from 'lucide-react';
import { StatusBadge, QueryStateBoundary, Pager, EmptyStrip, CONSOLE_CARD_CLASS } from '@/components/sofia';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useSofiaCustomerServiceCases,
  useSofiaCustomerServiceCase,
  useSofiaCustomerServiceTransition,
} from '@/features/sofia/queries';
import type { SofiaCustomerServiceCaseDetail, SofiaCustomerServiceCaseSummary } from '@/features/sofia/contracts';
import {
  CASE_ICON,
  caseStatusLabel,
  formatCaseCategory,
  nextCaseStatus,
  toneFromCaseStatus,
  truncateReferenceId,
  TONE_AVATAR_CLASS_CONSOLE,
} from './labels';

const PAGE_SIZE = 10;
const CASE_STATUS_OPTIONS = ['OPEN', 'HUMAN_REQUIRED', 'HUMAN_TAKEN', 'RESOLVED', 'CLOSED'] as const;

function ReferenceChips({
  item,
  'data-testid': testId,
}: {
  item: Pick<SofiaCustomerServiceCaseSummary, 'orderCheckoutId' | 'orderTicketId' | 'paymentIntentId' | 'deliveryIssueId'>;
  'data-testid'?: string;
}) {
  const refs: Array<{ label: string; id: string }> = [];
  if (item.orderCheckoutId) refs.push({ label: 'Checkout', id: item.orderCheckoutId });
  if (item.orderTicketId) refs.push({ label: 'Ticket', id: item.orderTicketId });
  if (item.paymentIntentId) refs.push({ label: 'Pago', id: item.paymentIntentId });
  if (item.deliveryIssueId) refs.push({ label: 'Domicilio', id: item.deliveryIssueId });

  if (refs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_25rem]" data-testid="sofia-validation-cases-panel">
      <div className={cn(CONSOLE_CARD_CLASS)} data-testid="sofia-validation-cases-list-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1.5 pb-2.5 text-white/55">
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Filtros</span>
          </div>
          <div className="min-w-[11rem]">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70" htmlFor="sofia-validation-cases-filter-status">
              Estado
            </label>
            <Select
              id="sofia-validation-cases-filter-status"
              className="mt-1 border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setSelectedId(null);
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
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70" htmlFor="sofia-validation-cases-filter-category">
              Categoría
            </label>
            <Input
              id="sofia-validation-cases-filter-category"
              className="mt-1 border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
                setSelectedId(null);
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
            variant="console"
            data-testid="sofia-validation-cases-list"
          >
            {(data) =>
              data.items.length === 0 ? (
                <div data-testid="sofia-validation-cases-empty">
                  <EmptyStrip
                    variant="console"
                    title="No hay casos con estos filtros"
                    description="Cuando SOFIA escale una conversación a un humano, el caso aparecerá aquí para su gestión y trazabilidad."
                  />
                </div>
              ) : (
                <>
                  <p className="mb-2.5 text-[11.5px] font-medium text-white/55" data-testid="sofia-validation-cases-count">
                    {data.total} {data.total === 1 ? 'caso' : 'casos'} con los filtros actuales
                  </p>
                  <ul className="space-y-2" data-testid="sofia-validation-cases-rows">
                    {data.items.map((item) => {
                      const isActive = item.id === selectedId;
                      const tone = toneFromCaseStatus(item.status);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow]',
                              isActive
                                ? 'border-brand-400 bg-brand-400/[0.08] shadow-soft'
                                : 'border-white/10 bg-white/[0.04] hover:border-brand-400/40 hover:bg-white/[0.06]',
                            )}
                            data-testid={`sofia-validation-case-row-${item.id}`}
                          >
                            <span
                              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', TONE_AVATAR_CLASS_CONSOLE[tone])}
                              aria-hidden="true"
                            >
                              <CASE_ICON className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-[13px] font-semibold text-white">{formatCaseCategory(item.category)}</p>
                                <StatusBadge tone={tone} label={caseStatusLabel(item.status)} variant="console" className="shrink-0" />
                              </div>
                              <p className="truncate text-[12px] text-white/70">
                                {item.customer?.displayName ?? 'Sin cliente identificado'} · Origen: {item.source}
                              </p>
                              {item.sanitizedSummary && <p className="truncate text-[12px] text-white/70" title={item.sanitizedSummary}>{item.sanitizedSummary}</p>}
                              <ReferenceChips item={item} />
                              <p className="text-[11px] text-white/55">{formatDateTime(item.updatedAt)}</p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3">
                    <Pager
                      page={data.page}
                      limit={data.limit}
                      total={data.total}
                      itemsLabel={data.total === 1 ? 'caso' : 'casos'}
                      onPrev={() => setPage((current) => Math.max(1, current - 1))}
                      onNext={() => setPage((current) => current + 1)}
                      variant="console"
                      data-testid="sofia-validation-cases-pager"
                    />
                  </div>
                </>
              )
            }
          </QueryStateBoundary>
        </div>
      </div>

      {selectedId ? (
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CaseDetail caseId={selectedId} onClosed={() => setSelectedId(null)} />
        </div>
      ) : (
        <div className={cn(CONSOLE_CARD_CLASS, 'lg:sticky lg:top-4 lg:self-start')} data-testid="sofia-validation-case-detail-placeholder">
          <EmptyStrip
            variant="console"
            title="Ningún caso seleccionado"
            description="Elige un caso de la lista para ver su línea de tiempo y transicionarlo al siguiente estado."
          />
        </div>
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
    <div className={cn(CONSOLE_CARD_CLASS)} data-testid="sofia-validation-case-detail">
      <QueryStateBoundary
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        error={detailQuery.error}
        data={detailQuery.data}
        loadingLabel="Cargando detalle del caso…"
        errorTitle="No se pudo cargar el caso"
        variant="console"
      >
        {(caseData) => {
          const next = nextCaseStatus(caseData.status);
          const tone = toneFromCaseStatus(caseData.status);
          return (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', TONE_AVATAR_CLASS_CONSOLE[tone])} aria-hidden="true">
                    <CASE_ICON className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">Caso de servicio al cliente</p>
                    <h2 className="mt-0.5 truncate text-[15px] font-bold text-white">{formatCaseCategory(caseData.category)}</h2>
                    <div className="mt-1.5">
                      <StatusBadge tone={tone} label={caseStatusLabel(caseData.status)} variant="console" />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClosed}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-[background-color] hover:bg-white/10"
                  aria-label="Cerrar detalle del caso"
                  data-testid="sofia-validation-case-detail-close"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {caseData.sanitizedSummary && (
                <p className="rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[12.5px] leading-5.5 text-white/85">
                  {caseData.sanitizedSummary}
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 text-[12px]">
                <DetailField label="Cliente" value={caseData.customer?.displayName ?? 'Sin identificar'} />
                <DetailField label="Origen" value={caseData.source} />
                <DetailField label="Asignado a" value={caseData.assignedActor?.fullName ?? 'Sin asignar'} />
                <DetailField label="Versión" value={String(caseData.version)} />
                {caseData.resolutionCode && <DetailField label="Código de resolución" value={caseData.resolutionCode} />}
                <DetailField label="Actualizado" value={formatDateTime(caseData.updatedAt)} />
              </dl>

              <ReferenceChips item={caseData} data-testid="sofia-validation-case-detail-references" />

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">Línea de tiempo</p>
                {caseData.events.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-white/70">Sin eventos registrados todavía.</p>
                ) : (
                  <ol className="mt-2.5 space-y-3 border-l border-white/10 pl-4" data-testid="sofia-validation-case-timeline">
                    {caseData.events.map((event) => (
                      <li key={event.id} className="relative text-[12px]">
                        <span className="absolute -left-[1.32rem] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-brand-500" aria-hidden="true" />
                        <p className="font-semibold text-white">
                          {event.action}
                          {event.fromStatus ? ` · ${caseStatusLabel(event.fromStatus)} → ${caseStatusLabel(event.toStatus)}` : ` · ${caseStatusLabel(event.toStatus)}`}
                        </p>
                        {event.reasonCode && <p className="mt-0.5 text-white/70">Motivo: {event.reasonCode}</p>}
                        <p className="mt-0.5 text-white/55">{formatDateTime(event.createdAt)}</p>
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
                  className="space-y-2 rounded-2xl border border-brand-400/25 bg-brand-400/[0.08] p-3.5"
                  data-testid="sofia-validation-case-transition-form"
                >
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    Mover a «{caseStatusLabel(next)}»
                  </p>
                  <Input
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value)}
                    placeholder="reasonCode, ej. OPERATOR_TOOK_CASE"
                    className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                    data-testid="sofia-validation-case-transition-reason"
                  />
                  {next === 'RESOLVED' && (
                    <Input
                      value={resolutionCode}
                      onChange={(event) => setResolutionCode(event.target.value)}
                      placeholder="resolutionCode, ej. RESOLVED_REFUND_ISSUED"
                      className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                      data-testid="sofia-validation-case-transition-resolution"
                    />
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    className="w-full"
                    disabled={transition.isPending || !reasonCode.trim() || (next === 'RESOLVED' && !resolutionCode.trim())}
                    data-testid="sofia-validation-case-transition-submit"
                  >
                    {transition.isPending ? 'Moviendo…' : `Mover a ${caseStatusLabel(next)}`}
                  </Button>
                </form>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[12px] text-white/70" data-testid="sofia-validation-case-not-actionable">
                  Este caso está cerrado y no admite más transiciones.
                </p>
              )}
            </div>
          );
        }}
      </QueryStateBoundary>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-white">{value}</dd>
    </div>
  );
}
