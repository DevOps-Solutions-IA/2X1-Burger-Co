'use client';

import { useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import { DataTableShell, type DataTableColumn, StatusBadge } from '@/components/product';
import { formatDateTime } from '@/lib/format';
import type { CrmPipeline } from './contracts';
import { CrmPagination } from './pagination';
import { clampCrmPage } from './pagination-model';
import { CrmQueryPanel } from './query-panel';
import { useCrmPipelines } from './queries';

const columns: DataTableColumn<CrmPipeline>[] = [
  { id: 'name', header: 'Pipeline', cell: (row) => <div><p className="font-semibold">{row.name}</p><p className="mt-1 max-w-md text-xs text-muted">{row.description || 'Sin descripción'}</p></div> },
  { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'stages', header: 'Etapas', numeric: true, cell: (row) => row.stages.length },
  { id: 'leads', header: 'Leads', numeric: true, cell: (row) => row._count.leads },
  { id: 'updated', header: 'Actualizado', cell: (row) => <span className="text-xs text-muted">{formatDateTime(row.updatedAt)}</span> },
];

export function PipelinesView() {
  const [page, setPage] = useState(1);
  const query = useCrmPipelines(undefined, page);

  useEffect(() => {
    if (!query.data) return;
    setPage((current) => clampCrmPage(current, query.data.pagination.pages));
  }, [query.data]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-brand-800"><Layers3 className="h-5 w-5" /></span><div><h2 className="font-heading text-lg font-bold text-ink">Pipelines gobernados</h2><p className="mt-1 text-sm leading-6 text-muted">Las etapas y resultados provienen del dominio CRM. Ganado y perdido son estados terminales auditados.</p></div></div>
      </div>
      <CrmQueryPanel pending={query.isPending} error={query.error} empty={query.data?.data.length === 0} onRetry={() => void query.refetch()} emptyTitle="No hay pipelines" emptyDescription="Un administrador debe crear el primer pipeline mediante el contrato CRM autorizado.">
        <div className="space-y-4">
          <DataTableShell rows={query.data?.data ?? []} columns={columns} rowKey={(row) => row.id} caption="Pipelines CRM" density="compact" />
          {query.data ? <CrmPagination page={query.data.pagination.page} pages={query.data.pagination.pages} total={query.data.pagination.total} noun="pipelines" disabled={query.isFetching} onChange={setPage} /> : null}
        </div>
      </CrmQueryPanel>
    </div>
  );
}
