'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pager, QueryStateBoundary, StatusBadge, type SofiaStatusTone } from '@/components/sofia';
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Tareas</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">
            Tareas y seguimientos vinculados a este cliente. La gestión completa vive en{' '}
            <Link href="/sofia/crm/tasks" className="font-semibold text-brand-700 hover:text-brand-900">
              Tareas
            </Link>
            .
          </p>
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
        {(result) => (
          <>
            {result.data.length === 0 ? (
              <div className="mt-3">
                <EmptyState icon={<ListChecks className="h-5 w-5" aria-hidden="true" />} title="Sin tareas" description="Este cliente no tiene tareas registradas." />
              </div>
            ) : (
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
            )}
            <div className="mt-3">
              <Pager
                page={result.pagination.page}
                limit={result.pagination.limit}
                total={result.pagination.total}
                pages={result.pagination.pages}
                itemsLabel="tareas"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => Math.min(Math.max(1, result.pagination.pages), current + 1))}
                data-testid="sofia-customer360-tasks-pagination"
              />
            </div>
            <Link
              href="/sofia/crm/tasks"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900"
              data-testid="sofia-customer360-tasks-link"
            >
              Ver todas las tareas
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        )}
      </QueryStateBoundary>
    </Card>
  );
}
