'use client';

import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { QueryStateBoundary, StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import { useSofiaCrmTasks } from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';

const TASK_STATUS_TONE: Record<string, SofiaStatusTone> = {
  OPEN: 'pending',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'read_only',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

const TYPE_LABEL: Record<string, string> = {
  TASK: 'Tarea',
  FOLLOW_UP: 'Seguimiento',
};

const PAGE_SIZE = 10;

export function TasksPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const tasks = useSofiaCrmTasks({ customerId, page, limit: PAGE_SIZE });

  return (
    <Card data-testid="sofia-customer360-tasks-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Tareas</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">Tareas y seguimientos vinculados a este cliente.</p>
        </div>
        <ListChecks className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
      </div>

      <QueryStateBoundary
        isLoading={tasks.isLoading}
        isError={tasks.isError}
        error={tasks.error}
        data={tasks.data}
        loadingLabel="Cargando tareas del cliente…"
        errorTitle="No se pudo cargar las tareas"
      >
        {(result) =>
          result.data.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-stone-200 bg-stone-50/85 px-3.5 py-3 text-[12px] text-stone-600">
              Este cliente no tiene tareas registradas.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {result.data.map((task) => (
                  <li key={task.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-bold text-ink">{task.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{TYPE_LABEL[task.type] ?? task.type}</Badge>
                        <Badge tone={task.priority === 'URGENT' || task.priority === 'HIGH' ? 'warning' : 'neutral'}>
                          {PRIORITY_LABEL[task.priority] ?? task.priority}
                        </Badge>
                        <StatusBadge tone={TASK_STATUS_TONE[task.status] ?? 'read_only'} label={TASK_STATUS_LABEL[task.status] ?? task.status} />
                      </div>
                    </div>
                    {task.sanitizedDescription && <p className="mt-1 text-[12px] leading-5 text-stone-600">{task.sanitizedDescription}</p>}
                    <p className="mt-1 text-[11px] text-stone-600">
                      {task.assignedTo ? `Asignada a ${task.assignedTo.fullName}` : 'Sin asignar'}
                      {task.dueAt ? ` · Vence ${formatDateTime(task.dueAt)}` : ''}
                    </p>
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
