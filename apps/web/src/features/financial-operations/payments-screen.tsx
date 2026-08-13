'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileClock,
  Link2,
  RadioTower,
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
  paymentIntentStatuses,
  paymentLinkStatuses,
  requiresFinancialReview,
  type PaymentIntent,
  type PaymentIntentStatus,
  type PaymentLink,
  type PaymentTransition,
  type PaymentWebhook,
} from './contracts';
import {
  usePaymentIntent,
  usePaymentIntents,
  usePaymentLinks,
  usePaymentTransitions,
  usePaymentWebhooks,
  type PaymentView,
} from './queries';

const viewOptions: Array<{ id: PaymentView; label: string; icon: ReactNode }> = [
  { id: 'intents', label: 'Intenciones', icon: <CircleDollarSign className="h-4 w-4" /> },
  { id: 'links', label: 'Enlaces', icon: <Link2 className="h-4 w-4" /> },
  { id: 'transitions', label: 'Transiciones', icon: <FileClock className="h-4 w-4" /> },
  { id: 'webhooks', label: 'Webhooks', icon: <RadioTower className="h-4 w-4" /> },
];

export function PaymentsScreen() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<PaymentView>('intents');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);

  useEffect(() => {
    const intentId = searchParams?.get('intent')?.trim();
    if (!intentId) return;
    setView('intents');
    setSelectedIntentId(intentId);
  }, [searchParams]);

  const intents = usePaymentIntents(page, status as PaymentIntentStatus | '', view === 'intents');
  const links = usePaymentLinks(page, status, view === 'links');
  const transitions = usePaymentTransitions(page, status as PaymentIntentStatus | '', view === 'transitions');
  const webhooks = usePaymentWebhooks(page, status, view === 'webhooks');
  const selectedIntent = usePaymentIntent(selectedIntentId);

  const activeQuery = view === 'intents' ? intents : view === 'links' ? links : view === 'transitions' ? transitions : webhooks;
  const total = activeQuery.data?.total ?? 0;
  const totalPages = activeQuery.data ? Math.ceil(activeQuery.data.total / activeQuery.data.limit) : 0;

  const changeView = (next: PaymentView) => {
    setView(next);
    setPage(1);
    setStatus('');
  };

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Control financiero"
        title="Pagos y evidencia"
        description="Consulta la verdad financiera canónica. Los resultados desconocidos y las revisiones nunca se presentan como pagos exitosos."
        status={<StatusBadge status="READ_ONLY" label="Lectura gobernada" tone="info" />}
      />

      <nav aria-label="Vistas de pagos" className="overflow-x-auto border-b border-line">
        <div className="flex min-w-max gap-1" role="tablist">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={view === option.id}
              onClick={() => changeView(option.id)}
              className={`flex min-h-11 items-center gap-2 rounded-t-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${view === option.id ? 'bg-panel text-ink shadow-[inset_0_-2px_0_0_var(--color-brand-600)]' : 'text-muted hover:bg-panel hover:text-ink'}`}
            >
              <span aria-hidden="true">{option.icon}</span>{option.label}
            </button>
          ))}
        </div>
      </nav>

      <FilterBar
        filters={<StatusFilter view={view} value={status} onChange={(value) => { setStatus(value); setPage(1); }} />}
        activeCount={status ? 1 : 0}
        actions={status ? <Button type="button" variant="ghost" size="sm" onClick={() => { setStatus(''); setPage(1); }}>Limpiar</Button> : undefined}
      />

      <QueryState
        status={queryStatus(activeQuery, activeQuery.data?.items.length ?? 0)}
        title={activeQuery.isError ? 'No pudimos verificar la evidencia financiera' : 'No hay registros para estos filtros'}
        description={queryDescription(activeQuery.error)}
        onRetry={activeQuery.isError ? () => void activeQuery.refetch() : undefined}
      >
        {view === 'intents' && intents.data ? <IntentTable rows={intents.data.items} onOpen={setSelectedIntentId} /> : null}
        {view === 'links' && links.data ? <LinkTable rows={links.data.items} onOpenIntent={setSelectedIntentId} /> : null}
        {view === 'transitions' && transitions.data ? <TransitionTable rows={transitions.data.items} onOpenIntent={setSelectedIntentId} /> : null}
        {view === 'webhooks' && webhooks.data ? <WebhookTable rows={webhooks.data.items} onOpenIntent={setSelectedIntentId} /> : null}
      </QueryState>

      {activeQuery.data ? <Pagination page={page} pages={totalPages} total={total} onChange={setPage} disabled={activeQuery.isFetching} /> : null}

      <DetailDialog
        open={Boolean(selectedIntentId)}
        onClose={() => setSelectedIntentId(null)}
        title="Evidencia de intención de pago"
        description="Monto, vínculo comercial y transiciones proceden del dominio canónico."
      >
        <PaymentIntentDetail query={selectedIntent} />
      </DetailDialog>
    </main>
  );
}

function IntentTable({ rows, onOpen }: { rows: PaymentIntent[]; onOpen: (id: string) => void }) {
  const columns: readonly DataTableColumn<PaymentIntent>[] = [
    { id: 'intent', header: 'Intento', cell: (row) => <div><p className="font-semibold">Intento {row.attemptNumber}</p><p className="mt-1 font-mono text-xs text-muted">{shortId(row.id)}</p></div> },
    { id: 'provider', header: 'Proveedor', cell: (row) => row.provider },
    { id: 'amount', header: 'Monto', numeric: true, cell: (row) => <span className="font-semibold">{formatCurrency(row.amount)}</span> },
    { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} label={financialStatusLabel(row.status)} tone={financialTone(row.status)} /> },
    { id: 'checkout', header: 'Checkout', cell: (row) => <span className="font-mono text-xs">{shortId(row.checkoutId)}</span> },
    { id: 'updated', header: 'Actualizado', cell: (row) => formatDateTime(row.updatedAt) },
  ];
  return <DataTableShell rows={rows} columns={columns} rowKey={(row) => row.id} caption="Intenciones de pago" density="compact" rowActions={(row) => <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(row.id)} aria-label={`Ver intención ${row.id}`}>Ver</Button>} />;
}

function LinkTable({ rows, onOpenIntent }: { rows: PaymentLink[]; onOpenIntent: (id: string) => void }) {
  const columns: readonly DataTableColumn<PaymentLink>[] = [
    { id: 'link', header: 'Enlace', cell: (row) => <span className="font-mono text-xs">{shortId(row.id)}</span> },
    { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'payment', header: 'Pago', cell: (row) => <StatusBadge status={row.paymentIntent.status} label={financialStatusLabel(row.paymentIntent.status)} tone={financialTone(row.paymentIntent.status)} /> },
    { id: 'amount', header: 'Monto', numeric: true, cell: (row) => formatCurrency(row.paymentIntent.amount) },
    { id: 'expires', header: 'Expira', cell: (row) => formatDateTime(row.expiresAt) },
  ];
  return <DataTableShell rows={rows} columns={columns} rowKey={(row) => row.id} caption="Enlaces de pago" density="compact" rowActions={(row) => <Button type="button" variant="ghost" size="sm" onClick={() => onOpenIntent(row.paymentIntentId)}>Evidencia</Button>} />;
}

function TransitionTable({ rows, onOpenIntent }: { rows: PaymentTransition[]; onOpenIntent: (id: string) => void }) {
  const columns: readonly DataTableColumn<PaymentTransition>[] = [
    { id: 'transition', header: 'Transición', cell: (row) => <span className="font-mono text-xs">{shortId(row.id)}</span> },
    { id: 'from', header: 'Origen', cell: (row) => row.fromStatus ? <StatusBadge status={row.fromStatus} tone={financialTone(row.fromStatus)} /> : 'Estado inicial' },
    { id: 'to', header: 'Destino', cell: (row) => <StatusBadge status={row.toStatus} label={financialStatusLabel(row.toStatus)} tone={financialTone(row.toStatus)} /> },
    { id: 'reason', header: 'Motivo', cell: (row) => humanize(row.reasonCode) },
    { id: 'date', header: 'Fecha', cell: (row) => formatDateTime(row.createdAt) },
  ];
  return <DataTableShell rows={rows} columns={columns} rowKey={(row) => row.id} caption="Transiciones financieras" density="compact" rowActions={(row) => <Button type="button" variant="ghost" size="sm" onClick={() => onOpenIntent(row.paymentIntentId)}>Intento</Button>} />;
}

function WebhookTable({ rows, onOpenIntent }: { rows: PaymentWebhook[]; onOpenIntent: (id: string) => void }) {
  const columns: readonly DataTableColumn<PaymentWebhook>[] = [
    { id: 'event', header: 'Evento', cell: (row) => <div><p className="font-semibold">{row.eventType ?? 'Tipo no informado'}</p><p className="mt-1 font-mono text-xs text-muted">{shortId(row.eventId ?? row.id)}</p></div> },
    { id: 'provider', header: 'Proveedor', cell: (row) => row.provider },
    { id: 'signature', header: 'Firma', cell: (row) => <StatusBadge status={row.signatureValid ? 'VERIFIED' : 'INVALID'} label={row.signatureValid ? 'Verificada' : 'Inválida'} tone={row.signatureValid ? 'success' : 'danger'} /> },
    { id: 'processing', header: 'Procesamiento', cell: (row) => <StatusBadge status={row.processedStatus} /> },
    { id: 'received', header: 'Recibido', cell: (row) => formatDateTime(row.receivedAt) },
  ];
  return <DataTableShell rows={rows} columns={columns} rowKey={(row) => row.id} caption="Evidencia de webhooks" density="compact" rowActions={(row) => row.paymentIntentId ? <Button type="button" variant="ghost" size="sm" onClick={() => onOpenIntent(row.paymentIntentId!)}>Intento</Button> : <span className="text-xs text-muted">Sin vínculo</span>} />;
}

function PaymentIntentDetail({ query }: { query: ReturnType<typeof usePaymentIntent> }) {
  const intent = query.data;
  return (
    <QueryState status={queryStatus(query, intent ? 1 : 0)} onRetry={query.isError ? () => void query.refetch() : undefined}>
      {intent ? (
        <div className="space-y-6">
          {requiresFinancialReview(intent.status) ? (
            <div className="flex gap-3 rounded-xl border border-signal-warning/30 bg-signal-warning/10 p-4" role="alert">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-signal-warning" aria-hidden="true" />
              <div><p className="font-semibold text-ink">No existe confirmación financiera segura</p><p className="mt-1 text-sm leading-6 text-muted">Este estado requiere conciliación. No se interpreta como pago recibido.</p></div>
            </div>
          ) : null}
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Estado"><StatusBadge status={intent.status} label={financialStatusLabel(intent.status)} tone={financialTone(intent.status)} /></Fact>
            <Fact label="Monto"><strong>{formatCurrency(intent.amount)} {intent.currency}</strong></Fact>
            <Fact label="Proveedor">{intent.provider}</Fact>
            <Fact label="Cuenta vinculada">{intent.providerAccountBound ? 'Sí, mediante evidencia protegida' : 'No verificada'}</Fact>
            <Fact label="Checkout"><span className="font-mono text-xs">{intent.checkoutId}</span></Fact>
            <Fact label="Pedido">{intent.checkout.orderTicketId ? <Link className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline" href={`/orders/${intent.checkout.orderTicketId}`}>Abrir pedido <ArrowUpRight className="h-4 w-4" /></Link> : 'No asociado'}</Fact>
            <Fact label="Modalidad">{humanize(intent.checkout.fulfillment)} · {humanize(intent.checkout.paymentPreference)}</Fact>
            <Fact label="Actualización">{formatDateTime(intent.updatedAt)}</Fact>
          </dl>
          <section>
            <h3 className="font-heading text-base font-semibold text-ink">Transiciones efectivas</h3>
            <div className="mt-3">
              {intent.transitions?.length ? <Timeline label="Transiciones financieras" items={intent.transitions.map((event) => ({ id: event.id, title: `${event.fromStatus ? financialStatusLabel(event.fromStatus) : 'Inicio'} → ${financialStatusLabel(event.toStatus)}`, timestamp: formatDateTime(event.createdAt), description: humanize(event.reasonCode), tone: financialTone(event.toStatus) }))} /> : <p className="text-sm text-muted">No hay transiciones registradas.</p>}
            </div>
          </section>
          <section>
            <h3 className="font-heading text-base font-semibold text-ink">Evidencia del proveedor</h3>
            <div className="mt-3 space-y-2">
              {intent.webhookEvents?.length ? intent.webhookEvents.map((event) => <div key={event.id} className="rounded-xl border border-line bg-canvas p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-ink">{event.eventType ?? 'Evento sin tipo'}</span><StatusBadge status={event.processedStatus} /></div><p className="mt-2 text-muted">Firma {event.signatureValid ? 'verificada' : 'inválida'} · cuenta {event.providerAccountBound ? 'vinculada' : 'no vinculada'} · payload {event.payloadEvidencePresent ? 'con evidencia' : 'sin evidencia'}</p></div>) : <p className="text-sm text-muted">No hay webhooks vinculados a esta intención.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </QueryState>
  );
}

function StatusFilter({ view, value, onChange }: { view: PaymentView; value: string; onChange: (value: string) => void }) {
  const options = view === 'links' ? paymentLinkStatuses : view === 'webhooks' ? [] : paymentIntentStatuses;
  return (
    <label className="grid gap-1 text-sm font-semibold text-ink">
      <span>Estado</span>
      {view === 'webhooks' ? (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Estado de procesamiento" className="h-11 min-w-64 rounded-xl border border-line bg-panel px-3 font-normal outline-none focus:ring-2 focus:ring-brand-500" />
      ) : (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-56 rounded-xl border border-line bg-panel px-3 font-normal outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">Todos</option>
          {options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
        </select>
      )}
    </label>
  );
}

function Pagination({ page, pages, total, onChange, disabled }: { page: number; pages: number; total: number; onChange: (page: number) => void; disabled: boolean }) {
  return <nav aria-label="Paginación" className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted">{total.toLocaleString('es-CO')} registros · página {page} de {Math.max(pages, 1)}</p><div className="flex gap-2"><Button type="button" variant="secondary" size="sm" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" />Anterior</Button><Button type="button" variant="secondary" size="sm" disabled={disabled || pages === 0 || page >= pages} onClick={() => onChange(page + 1)}>Siguiente<ChevronRight className="h-4 w-4" /></Button></div></nav>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt><dd className="mt-2 text-sm text-ink">{children}</dd></div>;
}

function queryStatus(query: { isLoading: boolean; isError: boolean; error: unknown }, count: number) {
  if (query.isLoading) return 'loading' as const;
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'permission_denied' as const : 'error' as const;
  return count === 0 ? 'empty' as const : 'ready' as const;
}

function queryDescription(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'Tu rol no permite consultar evidencia financiera.';
  return error instanceof Error ? error.message : undefined;
}

function financialTone(status: PaymentIntentStatus) {
  if (status === 'SUCCEEDED') return 'success' as const;
  if (requiresFinancialReview(status)) return 'warning' as const;
  if (status === 'FAILED' || status === 'CANCELLED') return 'danger' as const;
  if (status === 'PENDING' || status === 'LINK_READY' || status === 'CREATED') return 'info' as const;
  return 'neutral' as const;
}

function financialStatusLabel(status: PaymentIntentStatus) {
  if (status === 'SUCCEEDED') return 'Pago verificado';
  if (status === 'UNKNOWN_RESULT') return 'Resultado desconocido';
  if (status === 'FINANCIAL_REVIEW_REQUIRED') return 'Revisión financiera';
  return humanize(status);
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase('es-CO').replace(/^./, (character) => character.toLocaleUpperCase('es-CO'));
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
