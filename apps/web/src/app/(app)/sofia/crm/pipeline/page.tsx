'use client';

import { useState } from 'react';
import { Plus, Workflow } from 'lucide-react';
import { CrmFrame, PageHeader, QueryStateBoundary, StatusBadge } from '@/components/sofia';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { useSofiaCrmPipelines } from '@/features/sofia/queries';
import { CreateLeadForm } from '@/features/sofia/crm/pipeline/CreateLeadForm';
import { PipelineBoard } from '@/features/sofia/crm/pipeline/PipelineBoard';

const PIPELINES_PAGE_LIMIT = 50;

export default function SofiaCrmPipelinePage() {
  const pipelines = useSofiaCrmPipelines(1, PIPELINES_PAGE_LIMIT);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [isCreatingLead, setIsCreatingLead] = useState(false);

  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-pipeline-page">
        <PageHeader
          eyebrow="CRM"
          title="Pipeline"
          description="Leads reales agrupados por etapa del pipeline activo. Cada transición queda auditada con motivo, actor y versión."
          data-testid="sofia-crm-pipeline-header"
        />

        <QueryStateBoundary
          isLoading={pipelines.isLoading}
          isError={pipelines.isError}
          error={pipelines.error}
          data={pipelines.data}
          loadingLabel="Cargando pipelines…"
          errorTitle="No se pudo cargar los pipelines"
          data-testid="sofia-crm-pipeline-list"
        >
          {(result) => {
            if (result.data.length === 0) {
              return (
                <EmptyState
                  icon={<Workflow className="h-5 w-5" />}
                  title="Sin pipelines"
                  description="Todavía no hay pipelines de ventas configurados en el CRM. Un pipeline define las etapas por las que pasa un lead."
                  data-testid="sofia-crm-pipeline-empty"
                />
              );
            }

            const activePipeline =
              result.data.find((pipeline) => pipeline.id === selectedPipelineId) ??
              result.data.find((pipeline) => pipeline.status === 'ACTIVE') ??
              result.data[0];

            if (!activePipeline) {
              return null;
            }

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-stone-200/90 bg-white p-3.5 shadow-soft">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                    {result.data.length > 1 ? (
                      <div className="min-w-[14rem]">
                        <Select
                          value={activePipeline.id}
                          onChange={(event) => setSelectedPipelineId(event.target.value)}
                          data-testid="sofia-crm-pipeline-select"
                        >
                          {result.data.map((pipeline) => (
                            <option key={pipeline.id} value={pipeline.id}>
                              {pipeline.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <p className="text-[14px] font-extrabold text-ink">{activePipeline.name}</p>
                    )}
                    <StatusBadge
                      tone={activePipeline.status === 'ACTIVE' ? 'success' : 'read_only'}
                      label={activePipeline.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
                    />
                    <Badge tone="neutral">{activePipeline._count.leads} leads</Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIsCreatingLead((current) => !current)}
                    data-testid="sofia-crm-pipeline-new-lead-toggle"
                  >
                    <Plus className="h-4 w-4" />
                    Nuevo lead
                  </Button>
                </div>

                {isCreatingLead && <CreateLeadForm pipeline={activePipeline} onClose={() => setIsCreatingLead(false)} />}

                <PipelineBoard pipeline={activePipeline} />
              </div>
            );
          }}
        </QueryStateBoundary>
      </div>
    </CrmFrame>
  );
}
