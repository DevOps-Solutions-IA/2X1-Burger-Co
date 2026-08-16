'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary } from '@/components/sofia';
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
        <div className="space-y-3" data-testid="sofia-crm-segments-page-content">
          {result.data.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="Sin segmentos"
              description="Todavía no hay segmentos de clientes creados en el CRM."
              data-testid="sofia-crm-segments-empty"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="sofia-crm-segments-grid">
              {result.data.map((segment) => (
                <SegmentCard key={segment.id} segment={segment} />
              ))}
            </div>
          )}

          {result.pagination.pages > 1 && (
            <div
              className="flex items-center justify-between gap-3 rounded-[1.35rem] border border-stone-200/90 bg-white px-4 py-3"
              data-testid="sofia-crm-segments-pagination"
            >
              <p className="text-[12px] font-semibold text-stone-600">
                Página {result.pagination.page} de {result.pagination.pages} &middot; {result.pagination.total} segmentos
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  data-testid="sofia-crm-segments-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page >= result.pagination.pages}
                  onClick={() => setPage((current) => Math.min(result.pagination.pages, current + 1))}
                  data-testid="sofia-crm-segments-next"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </QueryStateBoundary>
  );
}
