'use client';

import { useEffect, useState } from 'react';
import { DataTableShell, type DataTableColumn, StatusBadge } from '@/components/product';
import { formatDateTime } from '@/lib/format';
import { CrmPagination } from './pagination';
import { clampCrmPage } from './pagination-model';
import { CrmQueryPanel } from './query-panel';
import { useCrmSegments, useCrmTags } from './queries';

type Segment = NonNullable<ReturnType<typeof useCrmSegments>['data']>['data'][number];
type Tag = NonNullable<ReturnType<typeof useCrmTags>['data']>['data'][number];

const segmentColumns: DataTableColumn<Segment>[] = [
  { id: 'name', header: 'Segmento', cell: (row) => <div><p className="font-semibold">{row.name}</p><p className="mt-1 text-xs text-muted">{row.description || 'Sin descripción'}</p></div> },
  { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'members', header: 'Miembros', numeric: true, cell: (row) => row._count.memberships },
  { id: 'campaigns', header: 'Campañas históricas', numeric: true, cell: (row) => row._count.campaigns },
  { id: 'updated', header: 'Actualizado', cell: (row) => <span className="text-xs text-muted">{formatDateTime(row.updatedAt)}</span> },
];

const tagColumns: DataTableColumn<Tag>[] = [
  { id: 'name', header: 'Tag', cell: (row) => <span className="font-semibold">{row.name}</span> },
  { id: 'assignments', header: 'Asignaciones', numeric: true, cell: (row) => row._count.assignments },
  { id: 'created', header: 'Creado', cell: (row) => <span className="text-xs text-muted">{formatDateTime(row.createdAt)}</span> },
];

export function SegmentsView() {
  const [segmentsPage, setSegmentsPage] = useState(1);
  const [tagsPage, setTagsPage] = useState(1);
  const segments = useCrmSegments(segmentsPage);
  const tags = useCrmTags(tagsPage);

  useEffect(() => {
    if (!segments.data) return;
    setSegmentsPage((current) => clampCrmPage(current, segments.data.pagination.pages));
  }, [segments.data]);

  useEffect(() => {
    if (!tags.data) return;
    setTagsPage((current) => clampCrmPage(current, tags.data.pagination.pages));
  }, [tags.data]);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="space-y-3"><div><h2 className="font-heading text-lg font-bold text-ink">Segmentos</h2><p className="mt-1 text-sm text-muted">Agrupaciones reales de clientes. El envío de campañas permanece bloqueado.</p></div><CrmQueryPanel pending={segments.isPending} error={segments.error} empty={segments.data?.data.length === 0} onRetry={() => void segments.refetch()} emptyTitle="No hay segmentos" emptyDescription="Todavía no existen agrupaciones CRM."><div className="space-y-4"><DataTableShell rows={segments.data?.data ?? []} columns={segmentColumns} rowKey={(row) => row.id} caption="Segmentos CRM" density="compact" />{segments.data ? <CrmPagination page={segments.data.pagination.page} pages={segments.data.pagination.pages} total={segments.data.pagination.total} noun="segmentos" disabled={segments.isFetching} onChange={setSegmentsPage} /> : null}</div></CrmQueryPanel></section>
      <section className="space-y-3"><div><h2 className="font-heading text-lg font-bold text-ink">Tags</h2><p className="mt-1 text-sm text-muted">Clasificación canónica aplicada a clientes.</p></div><CrmQueryPanel pending={tags.isPending} error={tags.error} empty={tags.data?.data.length === 0} onRetry={() => void tags.refetch()} emptyTitle="No hay tags" emptyDescription="Todavía no existen etiquetas CRM."><div className="space-y-4"><DataTableShell rows={tags.data?.data ?? []} columns={tagColumns} rowKey={(row) => row.id} caption="Tags CRM" density="compact" />{tags.data ? <CrmPagination page={tags.data.pagination.page} pages={tags.data.pagination.pages} total={tags.data.pagination.total} noun="tags" disabled={tags.isFetching} onChange={setTagsPage} /> : null}</div></CrmQueryPanel></section>
    </div>
  );
}
