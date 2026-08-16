'use client';

import { useState } from 'react';
import { Briefcase } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QueryStateBoundary, StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import { useSofiaCrmLeads } from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';

const LEAD_STATUS_TONE: Record<string, SofiaStatusTone> = {
  NEW: 'pending',
  QUALIFIED: 'read_only',
  ACTIVE: 'success',
  WON: 'success',
  LOST: 'blocked',
  ARCHIVED: 'read_only',
};

const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: 'Nuevo',
  QUALIFIED: 'Calificado',
  ACTIVE: 'Activo',
  WON: 'Ganado',
  LOST: 'Perdido',
  ARCHIVED: 'Archivado',
};

const PAGE_SIZE = 10;

export function LeadPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const leads = useSofiaCrmLeads({ customerId, page, limit: PAGE_SIZE });

  return (
    <Card data-testid="sofia-customer360-lead-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Pipeline</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">Leads de este cliente en el pipeline de ventas.</p>
        </div>
        <Briefcase className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
      </div>

      <QueryStateBoundary
        isLoading={leads.isLoading}
        isError={leads.isError}
        error={leads.error}
        data={leads.data}
        loadingLabel="Cargando leads del cliente…"
        errorTitle="No se pudo cargar el pipeline"
      >
        {(result) =>
          result.data.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-stone-200 bg-stone-50/85 px-3.5 py-3 text-[12px] text-stone-600">
              Este cliente no tiene leads en el pipeline.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {result.data.map((lead) => (
                  <li key={lead.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-bold text-ink">{lead.title}</p>
                      <StatusBadge tone={LEAD_STATUS_TONE[lead.status] ?? 'read_only'} label={LEAD_STATUS_LABEL[lead.status] ?? lead.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-stone-600">
                      {lead.pipeline.name} &middot; Etapa: {lead.currentStage.name} &middot; {lead.owner ? lead.owner.fullName : 'Sin dueño asignado'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-600">Actualizado {formatDateTime(lead.updatedAt)}</p>
                  </li>
                ))}
              </ul>
              {result.pagination.pages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-stone-600">
                    Página {result.pagination.page} de {result.pagination.pages}
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      Anterior
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={page >= result.pagination.pages}
                      onClick={() => setPage((current) => Math.min(result.pagination.pages, current + 1))}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </>
          )
        }
      </QueryStateBoundary>
    </Card>
  );
}
