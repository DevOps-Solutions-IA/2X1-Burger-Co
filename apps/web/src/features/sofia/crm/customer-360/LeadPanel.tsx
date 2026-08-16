'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Briefcase } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pager, QueryStateBoundary, StatusBadge, type SofiaStatusTone } from '@/components/sofia';
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Pipeline</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">
            Leads de este cliente en el pipeline de ventas. La gestión completa vive en{' '}
            <Link href="/sofia/crm/pipeline" className="font-semibold text-brand-700 hover:text-brand-900">
              Pipeline
            </Link>
            .
          </p>
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
        {(result) => (
          <>
            {result.data.length === 0 ? (
              <div className="mt-3">
                <EmptyState icon={<Briefcase className="h-5 w-5" aria-hidden="true" />} title="Sin leads" description="Este cliente no tiene leads en el pipeline." />
              </div>
            ) : (
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
            )}
            <div className="mt-3">
              <Pager
                page={result.pagination.page}
                limit={result.pagination.limit}
                total={result.pagination.total}
                pages={result.pagination.pages}
                itemsLabel="leads"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => Math.min(Math.max(1, result.pagination.pages), current + 1))}
                data-testid="sofia-customer360-lead-pagination"
              />
            </div>
            <Link
              href="/sofia/crm/pipeline"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900"
              data-testid="sofia-customer360-lead-link"
            >
              Ver pipeline completo
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        )}
      </QueryStateBoundary>
    </Card>
  );
}
