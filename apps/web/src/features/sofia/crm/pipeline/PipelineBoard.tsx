'use client';

import { Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia';
import { useSofiaCrmLeads } from '@/features/sofia/queries';
import type { SofiaCrmPipeline } from '@/features/sofia/contracts';
import { CRM_STAGE_OUTCOME_LABEL, stageOutcomeTone } from './lead-display';
import { LeadCard } from './LeadCard';

const LEADS_PAGE_LIMIT = 100;

/** Tablero kanban simplificado: leads del pipeline seleccionado agrupados por etapa actual. */
export function PipelineBoard({ pipeline }: { pipeline: SofiaCrmPipeline }) {
  const leads = useSofiaCrmLeads({ page: 1, limit: LEADS_PAGE_LIMIT, pipelineId: pipeline.id });

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);

  return (
    <QueryStateBoundary
      isLoading={leads.isLoading}
      isError={leads.isError}
      error={leads.error}
      data={leads.data}
      loadingLabel="Cargando leads del pipeline…"
      errorTitle="No se pudo cargar los leads"
      data-testid="sofia-crm-pipeline-board"
    >
      {(result) => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-crm-pipeline-columns">
          {stages.map((stage) => {
            const stageLeads = result.data.filter((lead) => lead.currentStageId === stage.id);
            return (
              <div key={stage.id} className="rounded-[1.35rem] border border-stone-200/90 bg-stone-50/70 p-3" data-testid="sofia-crm-pipeline-column">
                <div className="flex items-center justify-between gap-2 px-1">
                  <p className="truncate text-[13px] font-extrabold text-ink">{stage.name}</p>
                  <StatusBadge tone={stageOutcomeTone(stage.outcome)} label={CRM_STAGE_OUTCOME_LABEL[stage.outcome] ?? stage.outcome} />
                </div>
                <p className="mt-0.5 px-1 text-[11px] text-stone-500">{stageLeads.length} leads</p>
                <div className="mt-2.5 space-y-2.5">
                  {stageLeads.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-stone-200 bg-white px-3 py-3 text-center text-[11.5px] text-stone-500">
                      Sin leads en esta etapa.
                    </p>
                  ) : (
                    stageLeads.map((lead) => <LeadCard key={lead.id} lead={lead} stages={stages} />)
                  )}
                </div>
              </div>
            );
          })}

          {stages.length === 0 && (
            <div className="sm:col-span-2 xl:col-span-4">
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="Sin etapas configuradas"
                description="Este pipeline todavía no tiene etapas — no se pueden agrupar leads."
              />
            </div>
          )}

          {result.pagination.total > LEADS_PAGE_LIMIT && (
            <div className="sm:col-span-2 xl:col-span-4">
              <Badge tone="warning">
                Mostrando los primeros {LEADS_PAGE_LIMIT} de {result.pagination.total} leads del pipeline.
              </Badge>
            </div>
          )}
        </div>
      )}
    </QueryStateBoundary>
  );
}
