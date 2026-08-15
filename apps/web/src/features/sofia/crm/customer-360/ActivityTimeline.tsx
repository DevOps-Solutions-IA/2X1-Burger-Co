'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { StatusBadge, QueryStateBoundary } from '@/components/sofia/workspace';
import { useSofiaCrmCustomerTimeline } from '@/features/sofia/queries';

const PAGE_SIZE = 10;

const DIRECTION_TONE = { INBOUND: 'read_only', OUTBOUND: 'success', INTERNAL: 'pending' } as const;

export function ActivityTimeline({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const timeline = useSofiaCrmCustomerTimeline(customerId, { page, limit: PAGE_SIZE });

  return (
    <Card data-testid="sofia-customer360-activity">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Actividad</p>
      <h2 className="text-[15px] font-semibold text-ink">Línea de tiempo</h2>

      <QueryStateBoundary
        isLoading={timeline.isLoading}
        isError={timeline.isError}
        error={timeline.error}
        data={timeline.data}
        loadingLabel="Cargando actividad…"
        errorTitle="No se pudo cargar la actividad"
        data-testid="sofia-customer360-activity-boundary"
      >
        {(result) =>
          result.data.length > 0 ? (
            <>
              <div className="mt-3 space-y-2">
                {result.data.map((interaction) => (
                  <div key={interaction.id} className="rounded-[0.9rem] bg-stone-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-ink">{interaction.kind}</p>
                      <StatusBadge tone={DIRECTION_TONE[interaction.direction]} label={interaction.direction} withDot={false} />
                    </div>
                    <p className="mt-1 text-[11.5px] font-medium text-stone-500">{interaction.summary}</p>
                    <p className="mt-1 text-[10.5px] font-medium text-stone-600">
                      {interaction.channel} · {new Date(interaction.occurredAt).toLocaleString('es-CO')}
                    </p>
                  </div>
                ))}
              </div>

              {result.pagination.pages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Anterior
                  </Button>
                  <span className="text-[11.5px] font-medium text-stone-500">
                    Página {result.pagination.page} de {result.pagination.pages}
                  </span>
                  <Button variant="secondary" size="sm" disabled={page >= result.pagination.pages} onClick={() => setPage((current) => current + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="mt-3">
              <EmptyState title="Sin actividad" description="No hay interacciones registradas para este cliente todavía." />
            </div>
          )
        }
      </QueryStateBoundary>
    </Card>
  );
}
