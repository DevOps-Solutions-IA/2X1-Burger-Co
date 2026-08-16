'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useSofiaCrmCreateLead } from '@/features/sofia/queries';
import type { SofiaCrmPipeline } from '@/features/sofia/contracts';
import { CustomerPicker } from './CustomerPicker';
import { CRM_LEAD_SOURCE_LABEL, CRM_LEAD_SOURCE_OPTIONS } from './lead-display';

/** Formulario mínimo para crear un lead real — nunca fabrica un `customerId`. */
export function CreateLeadForm({ pipeline, onClose }: { pipeline: SofiaCrmPipeline; onClose: () => void }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [currentStageId, setCurrentStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [source, setSource] = useState<(typeof CRM_LEAD_SOURCE_OPTIONS)[number]>('AUTHORIZED_OPERATOR');
  const [sourceReference, setSourceReference] = useState('');
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const createLead = useSofiaCrmCreateLead();

  const canSubmit = Boolean(customerId) && Boolean(currentStageId) && sourceReference.trim().length > 0 && title.trim().length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId || !canSubmit) return;
    createLead.mutate(
      {
        customerId,
        pipelineId: pipeline.id,
        currentStageId,
        source,
        sourceReference: sourceReference.trim(),
        title: title.trim(),
        ownerId: ownerId.trim().length > 0 ? ownerId.trim() : undefined,
      },
      {
        onSuccess: () => onClose(),
      },
    );
  }

  return (
    <Card data-testid="sofia-crm-pipeline-create-lead-form">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Nuevo lead</h2>
          <p className="mt-0.5 text-[12px] text-stone-600">Vincula un lead real a un cliente existente del CRM en «{pipeline.name}».</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-testid="sofia-crm-pipeline-create-lead-cancel">
          Cancelar
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Cliente</label>
          <CustomerPicker
            selectedCustomerId={customerId}
            selectedCustomerLabel={customerLabel}
            onSelect={(id, label) => {
              setCustomerId(id);
              setCustomerLabel(label);
            }}
            onClear={() => {
              setCustomerId(null);
              setCustomerLabel(null);
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Etapa inicial</label>
            <Select value={currentStageId} onChange={(event) => setCurrentStageId(event.target.value)} data-testid="sofia-crm-pipeline-create-lead-stage">
              {pipeline.stages
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Origen</label>
            <Select
              value={source}
              onChange={(event) => setSource(event.target.value as (typeof CRM_LEAD_SOURCE_OPTIONS)[number])}
              data-testid="sofia-crm-pipeline-create-lead-source"
            >
              {CRM_LEAD_SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {CRM_LEAD_SOURCE_LABEL[option]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Referencia de origen</label>
          <Input
            value={sourceReference}
            onChange={(event) => setSourceReference(event.target.value)}
            placeholder="Ej: conversación-1234, orden-5678…"
            data-testid="sofia-crm-pipeline-create-lead-source-reference"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Título del lead</label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej: Interesado en catering para evento"
            data-testid="sofia-crm-pipeline-create-lead-title"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">ID de responsable (opcional)</label>
          <Input
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            placeholder="ID de operador autorizado"
            data-testid="sofia-crm-pipeline-create-lead-owner"
          />
        </div>

        {createLead.isError && (
          <p className="text-[12px] font-semibold text-red-700" role="alert">
            {createLead.error instanceof ApiError ? createLead.error.message : 'No se pudo crear el lead.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="submit" size="sm" disabled={!canSubmit || createLead.isPending} data-testid="sofia-crm-pipeline-create-lead-submit">
            {createLead.isPending ? 'Creando…' : 'Crear lead'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
