'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Headphones,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DataTableShell,
  DetailDialog,
  FilterBar,
  PageHeader,
  QueryState,
  StatusBadge,
  Timeline,
  type DataTableColumn,
} from '@/components/product';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import {
  nextServiceCaseStatus,
  serviceCaseCategories,
  serviceCaseStatuses,
  type ServiceCase,
  type ServiceCaseCategory,
  type ServiceCaseStatus,
} from './contracts';
import { useServiceCase, useServiceCases, useServiceCaseTransition } from './queries';

const categoryLabels: Readonly<Record<ServiceCaseCategory, string>> = {
  LATE_ORDER: 'Pedido demorado',
  WRONG_ITEM: 'Producto incorrecto',
  MISSING_ITEM: 'Producto faltante',
  COLD_FOOD: 'Producto frío',
  QUALITY: 'Calidad',
  PAYMENT_PROBLEM: 'Problema de pago',
  DELIVERY_PROBLEM: 'Problema de entrega',
  OTHER: 'Otro',
};

export function CustomerServiceScreen() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ServiceCaseStatus | ''>('');
  const [category, setCategory] = useState<ServiceCaseCategory | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const caseId = searchParams?.get('case')?.trim();
    if (caseId) setSelectedId(caseId);
  }, [searchParams]);
  const cases = useServiceCases(page, status, category);
  const selectedCase = useServiceCase(selectedId);
  const pages = cases.data ? Math.ceil(cases.data.total / cases.data.limit) : 0;

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Recuperación gobernada"
        title="Servicio al cliente"
        description="Casos, evidencia y atención humana sin prometer reembolsos, descuentos ni compensaciones fuera de una autoridad aprobada."
        status={<StatusBadge status="HUMAN_GOVERNED" label="Control humano" tone="info" />}
      />

      <FilterBar
        filters={(
          <>
            <SelectFilter label="Estado" value={status} onChange={(value) => { setStatus(value as ServiceCaseStatus | ''); setPage(1); }} options={serviceCaseStatuses.map((value) => ({ value, label: statusLabel(value) }))} />
            <SelectFilter label="Categoría" value={category} onChange={(value) => { setCategory(value as ServiceCaseCategory | ''); setPage(1); }} options={serviceCaseCategories.map((value) => ({ value, label: categoryLabels[value] }))} />
          </>
        )}
        activeCount={Number(Boolean(status)) + Number(Boolean(category))}
        actions={status || category ? <Button type="button" variant="ghost" size="sm" onClick={() => { setStatus(''); setCategory(''); setPage(1); }}>Limpiar</Button> : undefined}
      />

      <QueryState
        status={queryStatus(cases, cases.data?.items.length ?? 0)}
        title={cases.isError ? 'No pudimos consultar los casos' : 'No hay casos para estos filtros'}
        description={queryDescription(cases.error)}
        onRetry={cases.isError ? () => void cases.refetch() : undefined}
      >
        {cases.data ? <CasesTable rows={cases.data.items} onOpen={setSelectedId} /> : null}
      </QueryState>

      {cases.data ? <Pagination page={page} pages={pages} total={cases.data.total} onChange={setPage} disabled={cases.isFetching} /> : null}

      <DetailDialog
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title="Expediente del caso"
        description="Estado actual, relaciones y eventos versionados."
        mode="drawer"
      >
        <CaseDetail query={selectedCase} />
      </DetailDialog>
    </main>
  );
}

function CasesTable({ rows, onOpen }: { rows: ServiceCase[]; onOpen: (id: string) => void }) {
  const columns: readonly DataTableColumn<ServiceCase>[] = [
    { id: 'case', header: 'Caso', cell: (row) => <div><p className="font-semibold">{categoryLabels[row.category]}</p><p className="mt-1 font-mono text-xs text-muted">{shortId(row.id)}</p></div> },
    { id: 'customer', header: 'Cliente', cell: (row) => row.customer?.displayName ?? 'Cliente no vinculado' },
    { id: 'summary', header: 'Resumen', className: 'max-w-sm', cell: (row) => <p className="line-clamp-2 leading-5">{row.sanitizedSummary}</p> },
    { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} label={statusLabel(row.status)} tone={caseTone(row.status)} /> },
    { id: 'owner', header: 'Responsable', cell: (row) => row.assignedActor?.fullName ?? (row.assignedActorId ? 'Actor asignado' : 'Sin asignar') },
    { id: 'updated', header: 'Actualizado', cell: (row) => formatDateTime(row.updatedAt) },
  ];
  return <DataTableShell rows={rows} columns={columns} rowKey={(row) => row.id} caption="Casos de servicio al cliente" density="compact" rowActions={(row) => <Button type="button" size="sm" variant="ghost" onClick={() => onOpen(row.id)} aria-label={`Abrir caso ${row.id}`}>Abrir</Button>} />;
}

function CaseDetail({ query }: { query: ReturnType<typeof useServiceCase> }) {
  const serviceCase = query.data;
  const transition = useServiceCaseTransition();
  const nextStatus = serviceCase ? nextServiceCaseStatus[serviceCase.status] : null;

  return (
    <QueryState status={queryStatus(query, serviceCase ? 1 : 0)} onRetry={query.isError ? () => void query.refetch() : undefined}>
      {serviceCase ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusBadge status={serviceCase.status} label={statusLabel(serviceCase.status)} tone={caseTone(serviceCase.status)} />
              <span className="text-xs tabular-nums text-muted">Versión {serviceCase.version}</span>
            </div>
            <h3 className="mt-4 font-heading text-lg font-semibold text-ink">{categoryLabels[serviceCase.category]}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{serviceCase.sanitizedSummary}</p>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Cliente">{serviceCase.customer?.displayName ?? 'No vinculado'}</Fact>
            <Fact label="Responsable">{serviceCase.assignedActor?.fullName ?? (serviceCase.assignedActorId ? 'Actor asignado' : 'Sin asignar')}</Fact>
            <Fact label="Origen">{humanize(serviceCase.source)}</Fact>
            <Fact label="Creado">{formatDateTime(serviceCase.createdAt)}</Fact>
          </dl>

          <section>
            <h3 className="font-heading text-base font-semibold text-ink">Relaciones operativas</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Relation label="Cliente" available={Boolean(serviceCase.customerId)} href={serviceCase.customerId ? `/customers/${serviceCase.customerId}` : undefined} />
              <Relation label="Conversación" available={Boolean(serviceCase.conversationId)} href={serviceCase.conversationId ? `/conversations?conversation=${encodeURIComponent(serviceCase.conversationId)}` : undefined} />
              <Relation label="Pedido" available={Boolean(serviceCase.orderTicketId)} href={serviceCase.orderTicketId ? `/orders/${serviceCase.orderTicketId}` : undefined} />
              <Relation label="Pago" available={Boolean(serviceCase.paymentIntentId)} href={serviceCase.paymentIntentId ? `/payments?intent=${encodeURIComponent(serviceCase.paymentIntentId)}` : undefined} />
              <Relation label="Incidencia de entrega" available={Boolean(serviceCase.deliveryIssueId)} />
            </div>
          </section>

          {serviceCase.paymentIntent ? (
            <section className="rounded-xl border border-line bg-canvas p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-heading text-base font-semibold text-ink">Pago relacionado</h3><StatusBadge status={serviceCase.paymentIntent.status} /></div>
              <p className="mt-2 text-sm text-muted">{serviceCase.paymentIntent.provider} · {formatCurrency(serviceCase.paymentIntent.amount)} {serviceCase.paymentIntent.currency}</p>
              {['UNKNOWN_RESULT', 'FINANCIAL_REVIEW_REQUIRED'].includes(serviceCase.paymentIntent.status) ? <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-signal-warning"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />No existe pago confirmado; requiere revisión financiera.</p> : null}
            </section>
          ) : null}

          <section>
            <h3 className="font-heading text-base font-semibold text-ink">Historial versionado</h3>
            <div className="mt-3">
              {serviceCase.events?.length ? <Timeline label="Historial del caso" items={serviceCase.events.map((event) => ({ id: event.id, title: `${event.fromStatus ? statusLabel(event.fromStatus) : 'Inicio'} → ${statusLabel(event.toStatus)}`, timestamp: formatDateTime(event.createdAt), description: humanize(event.reasonCode), metadata: <span className="text-xs text-muted">Versión {event.version}</span>, tone: caseTone(event.toStatus) }))} /> : <p className="text-sm text-muted">No hay eventos adicionales registrados.</p>}
            </div>
          </section>

          {nextStatus ? <TransitionForm serviceCase={serviceCase} nextStatus={nextStatus} pending={transition.isPending} onSubmit={(payload) => transition.mutate(payload)} /> : <div className="flex gap-3 rounded-xl border border-signal-success/30 bg-signal-success/10 p-4"><ClipboardCheck className="h-5 w-5 shrink-0 text-signal-success" /><p className="text-sm leading-6 text-ink">El caso está cerrado. Su historial permanece disponible como evidencia.</p></div>}
        </div>
      ) : null}
    </QueryState>
  );
}

function TransitionForm({ serviceCase, nextStatus, pending, onSubmit }: { serviceCase: ServiceCase; nextStatus: ServiceCaseStatus; pending: boolean; onSubmit: (payload: { id: string; expectedVersion: number; toStatus: ServiceCaseStatus; reasonCode: string; resolutionCode?: string }) => void }) {
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const reasonCode = normalizedCode(reason);
    const resolutionCode = normalizedCode(resolution);
    if (!reasonCode || (nextStatus === 'RESOLVED' && !resolutionCode)) return;
    onSubmit({ id: serviceCase.id, expectedVersion: serviceCase.version, toStatus: nextStatus, reasonCode, ...(resolutionCode ? { resolutionCode } : {}) });
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-panel p-4" aria-label="Actualizar estado del caso">
      <div className="flex items-start gap-3"><Headphones className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" /><div><h3 className="font-heading text-base font-semibold text-ink">Siguiente acción: {transitionAction(nextStatus)}</h3><p className="mt-1 text-sm leading-6 text-muted">La actualización usa la versión {serviceCase.version}; si otra persona cambia el caso primero, el servidor la rechazará como obsoleta.</p></div></div>
      <label className="grid gap-1.5 text-sm font-semibold text-ink">Motivo operativo<input required maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. revisión solicitada" className="h-11 rounded-xl border border-line bg-panel px-3 font-normal outline-none focus:ring-2 focus:ring-brand-500" /></label>
      {nextStatus === 'RESOLVED' ? <label className="grid gap-1.5 text-sm font-semibold text-ink">Código de resolución<input required maxLength={200} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Ej. aclaración completada" className="h-11 rounded-xl border border-line bg-panel px-3 font-normal outline-none focus:ring-2 focus:ring-brand-500" /></label> : null}
      <div className="flex justify-end"><Button type="submit" disabled={pending || !reason.trim() || (nextStatus === 'RESOLVED' && !resolution.trim())}>{pending ? 'Actualizando…' : transitionAction(nextStatus)}</Button></div>
    </form>
  );
}

function Relation({ label, available, href }: { label: string; available: boolean; href?: string }) {
  return <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3 py-2"><span className="text-sm font-semibold text-ink">{label}</span>{available && href ? <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-800 hover:underline">Abrir<ArrowUpRight className="h-4 w-4" /></Link> : <span className="text-xs text-muted">{available ? 'Sin vista canónica' : 'No disponible'}</span>}</div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt><dd className="mt-2 flex items-center gap-2 text-sm text-ink"><CircleUserRound className="h-4 w-4 text-muted" aria-hidden="true" />{children}</dd></div>;
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="grid gap-1 text-sm font-semibold text-ink"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-52 rounded-xl border border-line bg-panel px-3 font-normal outline-none focus:ring-2 focus:ring-brand-500"><option value="">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Pagination({ page, pages, total, onChange, disabled }: { page: number; pages: number; total: number; onChange: (page: number) => void; disabled: boolean }) {
  return <nav aria-label="Paginación" className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted">{total.toLocaleString('es-CO')} casos · página {page} de {Math.max(pages, 1)}</p><div className="flex gap-2"><Button type="button" variant="secondary" size="sm" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" />Anterior</Button><Button type="button" variant="secondary" size="sm" disabled={disabled || pages === 0 || page >= pages} onClick={() => onChange(page + 1)}>Siguiente<ChevronRight className="h-4 w-4" /></Button></div></nav>;
}

function queryStatus(query: { isLoading: boolean; isError: boolean; error: unknown }, count: number) {
  if (query.isLoading) return 'loading' as const;
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'permission_denied' as const : 'error' as const;
  return count === 0 ? 'empty' as const : 'ready' as const;
}

function queryDescription(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'Tu rol no permite gestionar casos de servicio.';
  return error instanceof Error ? error.message : undefined;
}

function statusLabel(status: ServiceCaseStatus) {
  return ({ OPEN: 'Abierto', HUMAN_REQUIRED: 'Requiere humano', HUMAN_TAKEN: 'En atención humana', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' } as const)[status];
}

function caseTone(status: ServiceCaseStatus) {
  if (status === 'CLOSED' || status === 'RESOLVED') return 'success' as const;
  if (status === 'HUMAN_REQUIRED') return 'warning' as const;
  if (status === 'HUMAN_TAKEN') return 'info' as const;
  return 'neutral' as const;
}

function transitionAction(status: ServiceCaseStatus) {
  return ({ HUMAN_REQUIRED: 'Solicitar atención humana', HUMAN_TAKEN: 'Tomar caso', RESOLVED: 'Resolver caso', CLOSED: 'Cerrar caso', OPEN: 'Reabrir caso' } as const)[status];
}

function normalizedCode(value: string) {
  return value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._/-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 200);
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase('es-CO').replace(/^./, (character) => character.toLocaleUpperCase('es-CO'));
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
