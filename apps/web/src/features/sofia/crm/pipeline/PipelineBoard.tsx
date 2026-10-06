'use client';

import { Layers, TrendingUp, Trophy, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary, StatCard, StatusBadge } from '@/components/sofia';
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
      {(result) => {
        const activeCount = result.data.filter((lead) => lead.status === 'NEW' || lead.status === 'QUALIFIED' || lead.status === 'ACTIVE').length;
        const wonCount = result.data.filter((lead) => lead.status === 'WON').length;
        const lostCount = result.data.filter((lead) => lead.status === 'LOST').length;

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sofia-crm-pipeline-stats">
              <StatCard label="Leads en el pipeline" value={String(result.pagination.total)} icon={<Layers className="h-5 w-5" />} accent="brand" />
              <StatCard label="En curso" value={String(activeCount)} icon={<TrendingUp className="h-5 w-5" />} accent="ink" />
              <StatCard label="Ganados" value={String(wonCount)} icon={<Trophy className="h-5 w-5" />} accent="success" />
              <StatCard label="Perdidos" value={String(lostCount)} icon={<XCircle className="h-5 w-5" />} accent="danger" />
            </div>

            {stages.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="Sin etapas configuradas"
                description="Este pipeline todavía no tiene etapas — no se pueden agrupar leads."
              />
            ) : (
              <div className="-mx-1 overflow-x-auto pb-2" data-testid="sofia-crm-pipeline-columns">
                <div className="flex min-w-max gap-3.5 px-1">
                  {stages.map((stage) => {
                    const stageLeads = result.data.filter((lead) => lead.currentStageId === stage.id);
                    return (
                      <div
                        key={stage.id}
                        className="flex w-[19rem] shrink-0 flex-col rounded-[1.35rem] border border-stone-200/90 bg-stone-50/70 p-3.5"
                        data-testid="sofia-crm-pipeline-column"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-[13.5px] font-extrabold text-ink">{stage.name}</p>
                            <p className="mt-0.5 text-[11px] font-semibold text-stone-500">{stageLeads.length} leads</p>
                          </div>
                          <StatusBadge tone={stageOutcomeTone(stage.outcome)} label={CRM_STAGE_OUTCOME_LABEL[stage.outcome] ?? stage.outcome} />
                        </div>
                        <div className="mt-3 space-y-3">
                          {stageLeads.length === 0 ? (
                            <p className="rounded-2xl border border-dashed border-stone-200 bg-white px-3 py-4 text-center text-[11.5px] leading-5 text-stone-500">
                              Sin leads en esta etapa.
                            </p>
                          ) : (
                            stageLeads.map((lead) => <LeadCard key={lead.id} lead={lead} stages={stages} />)
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {result.pagination.total > LEADS_PAGE_LIMIT && (
              <Badge tone="warning">
                Mostrando los primeros {LEADS_PAGE_LIMIT} de {result.pagination.total} leads del pipeline.
              </Badge>
            )}
          </div>
        );
      }}
    </QueryStateBoundary>
  );
}
