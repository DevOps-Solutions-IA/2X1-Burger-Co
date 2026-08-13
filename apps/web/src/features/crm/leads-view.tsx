'use client';

import { FormEvent, useState } from 'react';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { DataTableShell, FilterBar, type DataTableColumn, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { canMutateCrm } from '@/features/auth/access-control';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { CrmLead, CrmLeadStatus } from './contracts';
import { customerName, isPermissionDeniedError, leadStatusLabels } from './labels';
import { useCrmLeads, useCrmPipelines, useTransitionCrmLead } from './queries';

const statuses: CrmLeadStatus[] = ['NEW', 'QUALIFIED', 'ACTIVE', 'WON', 'LOST', 'ARCHIVED'];

function transitionStatus(outcome: 'OPEN' | 'WON' | 'LOST', requested: CrmLeadStatus) {
  if (outcome === 'WON') return 'WON' as const;
  if (outcome === 'LOST') return 'LOST' as const;
  return requested === 'NEW' || requested === 'QUALIFIED' || requested === 'ACTIVE' ? requested : 'ACTIVE';
}

export function LeadsView() {
  const { user } = useAuth();
  const [status, setStatus] = useState<CrmLeadStatus | ''>('');
  const [pipelineId, setPipelineId] = useState('');
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [targetStageId, setTargetStageId] = useState('');
  const [targetStatus, setTargetStatus] = useState<CrmLeadStatus>('ACTIVE');
  const [mutationPermissionDenied, setMutationPermissionDenied] = useState(false);
  const leads = useCrmLeads({ status: status || undefined, pipelineId: pipelineId || undefined });
  const pipelines = useCrmPipelines('ACTIVE');
  const transition = useTransitionCrmLead();
  const canManageLeads = canMutateCrm(user?.roles) && !mutationPermissionDenied;
  const canTransition = canManageLeads && selected && !['WON', 'LOST', 'ARCHIVED'].includes(selected.status);
  const selectedPipeline = pipelines.data?.data.find((pipeline) => pipeline.id === selected?.pipelineId);
  const targetStage = selectedPipeline?.stages.find((stage) => stage.id === targetStageId);

  function openTransition(lead: CrmLead) {
    if (!canManageLeads) return;
    const pipeline = pipelines.data?.data.find((item) => item.id === lead.pipelineId);
    const next = pipeline?.stages.find((stage) => stage.position > lead.currentStage.position) ?? pipeline?.stages[0];
    setSelected(lead);
    setTargetStageId(next?.id ?? lead.currentStageId);
    setTargetStatus(lead.status === 'NEW' ? 'QUALIFIED' : 'ACTIVE');
    transition.reset();
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !targetStage) return;
    try {
      await transition.mutateAsync({
        leadId: selected.id,
        expectedVersion: selected.version,
        toStageId: targetStage.id,
        toStatus: transitionStatus(targetStage.outcome, targetStatus),
        idempotencyKey: `crm-ui:${selected.id}:${selected.version}:${crypto.randomUUID()}`,
      });
      toast.success('Lead actualizado con historial auditable.');
      setSelected(null);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setMutationPermissionDenied(true);
        setSelected(null);
        toast.error('Tu sesión no tiene permiso para modificar leads. La consulta permanece disponible.');
      } else if (error instanceof ApiError && error.status === 409) {
        toast.error('El lead cambió en otra sesión. Recargamos la versión actual.');
        await leads.refetch();
      } else {
        toast.error(error instanceof Error ? error.message : 'No pudimos actualizar el lead.');
      }
    }
  }

  const columns: DataTableColumn<CrmLead>[] = [
    { id: 'lead', header: 'Lead', cell: (row) => <div><p className="font-semibold">{row.title}</p><p className="mt-1 text-xs text-muted">{customerName(row.customer.displayName)}</p></div> },
    { id: 'pipeline', header: 'Pipeline / etapa', cell: (row) => <div><p className="text-sm">{row.pipeline.name}</p><p className="mt-1 text-xs text-muted">{row.currentStage.name}</p></div> },
    { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} label={leadStatusLabels[row.status]} /> },
    { id: 'owner', header: 'Responsable', cell: (row) => row.owner?.fullName ?? <span className="text-muted">Sin asignar</span> },
    { id: 'updated', header: 'Actualizado', cell: (row) => <span className="text-xs text-muted">{formatDateTime(row.updatedAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={Number(Boolean(status)) + Number(Boolean(pipelineId))}
        filters={<><label className="min-w-44"><span className="sr-only">Estado del lead</span><Select value={status} onChange={(event) => setStatus(event.target.value as CrmLeadStatus | '')}><option value="">Todos los estados</option>{statuses.map((item) => <option key={item} value={item}>{leadStatusLabels[item]}</option>)}</Select></label><label className="min-w-48"><span className="sr-only">Pipeline</span><Select value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}><option value="">Todos los pipelines</option>{pipelines.data?.data.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</Select></label></>}
        actions={<Button type="button" variant="ghost" onClick={() => { setStatus(''); setPipelineId(''); }}>Limpiar filtros</Button>}
        density="compact"
      />

      {!canManageLeads ? (
        <QueryState
          status="permission_denied"
          title="CRM en modo consulta"
          description="Puedes revisar leads, pero solo administración y supervisión pueden modificar su etapa o estado."
        />
      ) : null}

      {leads.isPending ? <QueryState status="loading" title="Consultando leads" /> : leads.error ? isPermissionDeniedError(leads.error) ? <QueryState status="permission_denied" title="No puedes consultar leads" description="El servidor rechazó el acceso a esta información." /> : <QueryState status="error" onRetry={() => void leads.refetch()} /> : leads.data?.data.length === 0 ? <QueryState status="empty" title="No hay leads con estos filtros" description="Ajusta los filtros o crea el lead desde un flujo autorizado." /> : <DataTableShell rows={leads.data?.data ?? []} columns={columns} rowKey={(row) => row.id} caption="Leads CRM" density="compact" rowActions={canManageLeads ? (row) => <Button type="button" variant="secondary" size="sm" onClick={() => openTransition(row)} disabled={['WON', 'LOST', 'ARCHIVED'].includes(row.status)}><ArrowRightLeft className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Mover</span></Button> : undefined} />}

      {selected ? (
        <section className="rounded-2xl border border-brand-200 bg-panel p-4 shadow-sm" aria-labelledby="lead-transition-title">
          <div className="flex items-start justify-between gap-3"><div><h2 id="lead-transition-title" className="font-heading text-lg font-bold text-ink">Mover “{selected.title}”</h2><p className="mt-1 text-sm text-muted">Se enviará la versión {selected.version}; si cambió, el servidor rechazará la operación sin sobrescribir datos.</p></div><Button type="button" variant="ghost" onClick={() => setSelected(null)}>Cerrar</Button></div>
          {!canTransition ? <QueryState status="permission_denied" title="Este lead ya está en estado terminal" description="Los leads ganados, perdidos o archivados no se reabren desde esta superficie." /> : (
            <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={submitTransition}>
              <label className="space-y-2 text-sm font-semibold text-ink"><span>Etapa de destino</span><Select value={targetStageId} onChange={(event) => setTargetStageId(event.target.value)} required>{selectedPipeline?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select></label>
              <label className="space-y-2 text-sm font-semibold text-ink"><span>Estado</span><Select value={targetStage?.outcome === 'WON' ? 'WON' : targetStage?.outcome === 'LOST' ? 'LOST' : targetStatus} onChange={(event) => setTargetStatus(event.target.value as CrmLeadStatus)} disabled={targetStage?.outcome !== 'OPEN'}>{statuses.filter((item) => ['NEW', 'QUALIFIED', 'ACTIVE'].includes(item)).map((item) => <option key={item} value={item}>{leadStatusLabels[item]}</option>)}{targetStage?.outcome === 'WON' ? <option value="WON">Ganado</option> : null}{targetStage?.outcome === 'LOST' ? <option value="LOST">Perdido</option> : null}</Select></label>
              <Button type="submit" disabled={!targetStageId || transition.isPending}>{transition.isPending ? 'Guardando…' : 'Confirmar transición'}</Button>
            </form>
          )}
          {transition.error ? <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-signal-danger" role="alert"><AlertTriangle className="h-4 w-4" />{transition.error.message}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
