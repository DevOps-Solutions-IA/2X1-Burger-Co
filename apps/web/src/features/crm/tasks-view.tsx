'use client';

import { useState } from 'react';
import { Check, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { DataTableShell, FilterBar, type DataTableColumn, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { CrmTask, CrmTaskStatus, CrmTaskType } from './contracts';
import { customerName, taskStatusLabels } from './labels';
import { useCrmTasks, useUpdateCrmTask } from './queries';

const statuses: CrmTaskStatus[] = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export function TasksView({ type }: { type: CrmTaskType }) {
  const [status, setStatus] = useState<CrmTaskStatus | ''>('');
  const query = useCrmTasks({ type, status: status || undefined });
  const update = useUpdateCrmTask();
  const title = type === 'FOLLOW_UP' ? 'seguimientos' : 'tareas';

  async function updateStatus(task: CrmTask, nextStatus: CrmTaskStatus) {
    try {
      await update.mutateAsync({ taskId: task.id, expectedVersion: task.version, status: nextStatus, assignedToId: task.assignedToId ?? undefined });
      toast.success(nextStatus === 'COMPLETED' ? 'Trabajo completado.' : 'Estado actualizado.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error('La tarea cambió en otra sesión. Recargamos la versión actual.');
        await query.refetch();
      } else {
        toast.error(error instanceof Error ? error.message : 'No pudimos actualizar el trabajo.');
      }
    }
  }

  const columns: DataTableColumn<CrmTask>[] = [
    { id: 'task', header: type === 'FOLLOW_UP' ? 'Seguimiento' : 'Tarea', cell: (row) => <div><p className="font-semibold">{row.title}</p><p className="mt-1 max-w-md text-xs text-muted">{row.sanitizedDescription || 'Sin descripción adicional'}</p></div> },
    { id: 'customer', header: 'Cliente', cell: (row) => <div><p>{customerName(row.customer.displayName)}</p>{row.lead ? <p className="mt-1 text-xs text-muted">Lead: {row.lead.title}</p> : null}</div> },
    { id: 'priority', header: 'Prioridad', cell: (row) => <StatusBadge status={row.priority} tone={row.priority === 'URGENT' ? 'danger' : row.priority === 'HIGH' ? 'warning' : 'neutral'} /> },
    { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} label={taskStatusLabels[row.status]} /> },
    { id: 'due', header: 'Vence', cell: (row) => <span className="text-xs text-muted">{row.dueAt ? formatDateTime(row.dueAt) : 'Sin vencimiento'}</span> },
  ];

  return (
    <div className="space-y-4">
      <FilterBar filters={<label className="min-w-48"><span className="sr-only">Estado</span><Select value={status} onChange={(event) => setStatus(event.target.value as CrmTaskStatus | '')}><option value="">Todos los estados</option>{statuses.map((item) => <option key={item} value={item}>{taskStatusLabels[item]}</option>)}</Select></label>} activeCount={status ? 1 : 0} actions={<Button type="button" variant="ghost" onClick={() => setStatus('')}>Limpiar filtro</Button>} density="compact" />
      {query.isPending ? <QueryState status="loading" title={`Consultando ${title}`} /> : query.error ? <QueryState status="error" onRetry={() => void query.refetch()} /> : query.data?.data.length === 0 ? <QueryState status="empty" title={`No hay ${title}`} description={`No existen ${title} reales con los filtros seleccionados.`} /> : <DataTableShell rows={query.data?.data ?? []} columns={columns} rowKey={(row) => row.id} caption={`${type === 'FOLLOW_UP' ? 'Seguimientos' : 'Tareas'} CRM`} density="compact" rowActions={(row) => row.status === 'OPEN' ? <Button type="button" size="sm" variant="secondary" onClick={() => void updateStatus(row, 'IN_PROGRESS')} disabled={update.isPending}><Play className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Iniciar</span></Button> : row.status === 'IN_PROGRESS' ? <div className="flex gap-1"><Button type="button" size="sm" onClick={() => void updateStatus(row, 'COMPLETED')} disabled={update.isPending}><Check className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Completar</span></Button><Button type="button" size="sm" variant="ghost" onClick={() => void updateStatus(row, 'CANCELLED')} disabled={update.isPending} aria-label="Cancelar"><X className="h-4 w-4" /></Button></div> : null} />}
      {update.error ? <p className="text-sm font-semibold text-signal-danger" role="alert">{update.error.message}</p> : null}
    </div>
  );
}
