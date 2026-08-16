'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useSofiaCrmTransitionLead } from '@/features/sofia/queries';
import type { SofiaCrmLeadSummary, SofiaCrmPipelineStage } from '@/features/sofia/contracts';
import { CRM_LEAD_STATUS_LABEL, CRM_LEAD_STATUS_OPTIONS } from './lead-display';

/**
 * Formulario de transición de un lead a otra etapa/estado del mismo pipeline.
 * Exige `reasonCode` antes de confirmar — la transición queda auditada en
 * `stageHistory` por el backend.
 */
export function TransitionLeadForm({
  lead,
  stages,
  onClose,
}: {
  lead: SofiaCrmLeadSummary;
  stages: SofiaCrmPipelineStage[];
  onClose: () => void;
}) {
  const [toStageId, setToStageId] = useState<string>(lead.currentStageId);
  const [toStatus, setToStatus] = useState<string>(lead.status);
  const [reasonCode, setReasonCode] = useState('');

  const transitionLead = useSofiaCrmTransitionLead();

  const canSubmit = reasonCode.trim().length > 0 && (toStageId !== lead.currentStageId || toStatus !== lead.status);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    transitionLead.mutate(
      {
        leadId: lead.id,
        expectedVersion: lead.version,
        toStageId,
        toStatus,
        idempotencyKey: crypto.randomUUID(),
        reasonCode: reasonCode.trim(),
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-2.5 rounded-2xl border border-stone-200 bg-stone-50 p-3"
      data-testid="sofia-crm-pipeline-transition-form"
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Nueva etapa</label>
          <Select value={toStageId} onChange={(event) => setToStageId(event.target.value)} data-testid="sofia-crm-pipeline-transition-stage">
            {stages
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
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Nuevo estado</label>
          <Select value={toStatus} onChange={(event) => setToStatus(event.target.value)} data-testid="sofia-crm-pipeline-transition-status">
            {CRM_LEAD_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {CRM_LEAD_STATUS_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Motivo (obligatorio)</label>
        <Input
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          placeholder="Ej: cliente confirmó pedido, seguimiento sin respuesta…"
          data-testid="sofia-crm-pipeline-transition-reason"
        />
      </div>

      {transitionLead.isError && (
        <p className="text-[11px] font-semibold text-red-700" role="alert">
          {transitionLead.error instanceof ApiError ? transitionLead.error.message : 'No se pudo transicionar el lead.'}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-testid="sofia-crm-pipeline-transition-cancel">
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit || transitionLead.isPending} data-testid="sofia-crm-pipeline-transition-submit">
          {transitionLead.isPending ? 'Moviendo…' : 'Confirmar'}
        </Button>
      </div>
    </form>
  );
}
