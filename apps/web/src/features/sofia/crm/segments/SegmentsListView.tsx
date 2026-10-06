'use client';

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Pager, QueryStateBoundary, StatCard } from '@/components/sofia';
import { useSofiaCrmSegments } from '@/features/sofia/queries';
import { SegmentCard } from './SegmentCard';

const PAGE_SIZE = 12;

export function SegmentsListView() {
  const [page, setPage] = useState(1);
  const segments = useSofiaCrmSegments(page, PAGE_SIZE);

  return (
    <QueryStateBoundary
      isLoading={segments.isLoading}
      isError={segments.isError}
      error={segments.error}
      data={segments.data}
      loadingLabel="Cargando segmentos…"
      errorTitle="No se pudo cargar los segmentos"
      data-testid="sofia-crm-segments-list"
    >
      {(result) => (
        <div className="space-y-4" data-testid="sofia-crm-segments-page-content">
          <StatCard
            label="Segmentos totales"
            value={String(result.pagination.total)}
            hint="Conteo real desde el backend del CRM."
            icon={<Layers className="h-5 w-5" />}
            accent="brand"
            className="max-w-xs"
            data-testid="sofia-crm-segments-total-stat"
          />

          {result.data.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="Sin segmentos"
              description="Todavía no hay segmentos de clientes creados en el CRM."
              data-testid="sofia-crm-segments-empty"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="sofia-crm-segments-grid">
              {result.data.map((segment) => (
                <SegmentCard key={segment.id} segment={segment} />
              ))}
            </div>
          )}

          <Pager
            page={result.pagination.page}
            limit={result.pagination.limit}
            total={result.pagination.total}
            pages={result.pagination.pages}
            itemsLabel="segmentos"
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => current + 1)}
            data-testid="sofia-crm-segments-pagination"
          />
        </div>
      )}
    </QueryStateBoundary>
  );
}
