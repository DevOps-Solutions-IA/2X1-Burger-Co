'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye, FileClock, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  DataTableShell,
  DetailDialog,
  FilterBar,
  PageHeader,
  QueryState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/product';
import type { AuditEvent, AuditResult } from './contracts';
import { errorIsPermissionDenied, fetchAuditEvents, formatDateTime, humanize } from './queries';

const results: Array<AuditResult | ''> = ['', 'SUCCESS', 'REJECTED', 'FAILED', 'CONFLICT', 'BLOCKED', 'NO_OP', 'ROLLED_BACK'];

function safeJson(value: unknown) {
  if (value === undefined || value === null) return 'Sin contexto';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Contexto no serializable';
  }
}

export function AuditWorkspace() {
  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resultFilter, setResultFilter] = useState<AuditResult | ''>('');
  const [applied, setApplied] = useState({ module: '', action: '', result: '' });
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (applied.module) params.set('module', applied.module);
    if (applied.action) params.set('action', applied.action);
    if (applied.result) params.set('result', applied.result);
    return params.toString();
  }, [applied, page]);

  const audit = useQuery({
    queryKey: ['governance', 'audit', queryString],
    queryFn: () => fetchAuditEvents(queryString),
  });

  const columns: Array<DataTableColumn<AuditEvent>> = [
    {
      id: 'time',
      header: 'Momento',
      mobileLabel: 'Momento',
      cell: (event) => <time className="text-xs tabular-nums text-muted">{formatDateTime(event.timestamp)}</time>,
    },
    {
      id: 'event',
      header: 'Evento',
      cell: (event) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{humanize(event.action)}</p>
          <p className="mt-1 text-xs text-muted">{event.module} · {event.entityType}</p>
        </div>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (event) => (
        <div>
          <p className="text-sm font-medium text-ink">{humanize(event.actorType)}</p>
          <p className="mt-1 text-xs text-muted">{event.actorRole ? humanize(event.actorRole) : 'Rol no disponible'}</p>
        </div>
      ),
    },
    {
      id: 'result',
      header: 'Resultado',
      cell: (event) => <StatusBadge status={event.result} label={humanize(event.result)} />,
    },
    {
      id: 'source',
      header: 'Fuente',
      cell: (event) => <span className="text-xs font-medium text-muted">{humanize(event.source)}</span>,
    },
  ];

  const status = audit.isPending
    ? 'loading'
    : errorIsPermissionDenied(audit.error)
      ? 'permission_denied'
      : audit.isError
        ? 'error'
        : audit.data.data.length === 0
          ? 'empty'
          : 'ready';

  const applyFilters = () => {
    setPage(1);
    setApplied({ module: moduleFilter.trim(), action: actionFilter.trim(), result: resultFilter });
  };

  const clearFilters = () => {
    setModuleFilter('');
    setActionFilter('');
    setResultFilter('');
    setApplied({ module: '', action: '', result: '' });
    setPage(1);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Gobernanza"
        title="Auditoría operacional"
        description="Evidencia sanitizada de decisiones, cambios y rechazos. Los datos sensibles permanecen redactados por el servidor."
        status={<StatusBadge status="ACTIVE" label="Registro canónico" tone="success" />}
      />

      <FilterBar
        activeCount={Object.values(applied).filter(Boolean).length}
        search={(
          <div className="grid gap-2 md:grid-cols-2">
            <label className="relative block">
              <span className="sr-only">Filtrar por módulo exacto</span>
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" aria-hidden="true" />
              <Input value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} placeholder="Módulo exacto" className="pl-10" />
            </label>
            <label className="block">
              <span className="sr-only">Filtrar por acción exacta</span>
              <Input value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} placeholder="Acción exacta" />
            </label>
          </div>
        )}
        filters={(
          <label className="min-w-44">
            <span className="sr-only">Filtrar por resultado</span>
            <Select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as AuditResult | '')}>
              <option value="">Todos los resultados</option>
              {results.filter(Boolean).map((result) => <option key={result} value={result}>{humanize(result)}</option>)}
            </Select>
          </label>
        )}
        actions={(
          <>
            <Button type="button" variant="secondary" onClick={clearFilters}>Limpiar</Button>
            <Button type="button" onClick={applyFilters}>Aplicar filtros</Button>
          </>
        )}
      />

      <QueryState
        status={status}
        title={status === 'empty' ? 'No hay eventos con estos filtros' : undefined}
        description={status === 'empty' ? 'La ausencia es un resultado real. Ajusta los filtros para ampliar la búsqueda.' : undefined}
        onRetry={() => void audit.refetch()}
      >
        {audit.data ? (
          <>
            <DataTableShell
              rows={audit.data.data}
              columns={columns}
              rowKey={(event) => event.id}
              caption="Eventos de auditoría"
              density="compact"
              rowActions={(event) => (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(event)} aria-label={`Ver detalle de ${event.action}`}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  <span className="md:sr-only">Ver detalle</span>
                </Button>
              )}
            />
            <nav aria-label="Paginación de auditoría" className="mt-4 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                Página <strong className="text-ink">{audit.data.pagination.page}</strong> de <strong className="text-ink">{Math.max(audit.data.pagination.pages, 1)}</strong> · {audit.data.pagination.total} eventos
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={page >= audit.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>
                  Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </>
        ) : null}
      </QueryState>

      <DetailDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? humanize(selected.action) : 'Detalle de auditoría'}
        description="Contexto sanitizado y correlaciones técnicas autorizadas."
      >
        {selected ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <AuditFact icon={<ShieldCheck className="h-4 w-4" />} label="Resultado" value={humanize(selected.result)} />
              <AuditFact icon={<FileClock className="h-4 w-4" />} label="Momento" value={formatDateTime(selected.timestamp)} />
              <AuditFact label="Razón" value={selected.reasonCode ? humanize(selected.reasonCode) : 'No informada'} />
              <AuditFact label="Versión" value={selected.legacy ? 'Legado, contexto limitado' : `Evento v${selected.eventVersion}`} />
            </div>
            <section>
              <h3 className="text-sm font-semibold text-ink">Correlación</h3>
              <dl className="mt-2 space-y-2 rounded-2xl bg-canvas p-4 text-xs text-muted">
                <div><dt className="font-semibold text-ink">Request</dt><dd className="mt-1 break-all font-mono">{selected.requestId ?? 'No disponible'}</dd></div>
                <div><dt className="font-semibold text-ink">Correlation</dt><dd className="mt-1 break-all font-mono">{selected.correlationId ?? 'No disponible'}</dd></div>
                <div><dt className="font-semibold text-ink">Entidad</dt><dd className="mt-1 break-all font-mono">{selected.entityId ?? 'No disponible'}</dd></div>
              </dl>
            </section>
            <SanitizedContext title="Antes" value={selected.before} />
            <SanitizedContext title="Después" value={selected.after} />
            <SanitizedContext title="Metadatos" value={selected.metadata} />
          </div>
        ) : null}
      </DetailDialog>
    </div>
  );
}

function AuditFact({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{icon}{label}</p>
      <p className="mt-2 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function SanitizedContext({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <pre className="mt-2 max-h-64 overflow-auto rounded-2xl border border-line bg-ink p-4 text-xs leading-5 text-stone-100" tabIndex={0}>{safeJson(value)}</pre>
    </section>
  );
}
