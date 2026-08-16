'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import { formatDateTime } from '@/lib/format';
import { useSofiaCrmUpdateTask } from '@/features/sofia/queries';
import type { SofiaCrmTask } from '@/features/sofia/contracts';
import { ApiError } from '@/lib/api';

const TASK_STATUS_TONE: Record<SofiaCrmTask['status'], SofiaStatusTone> = {
  OPEN: 'pending',
  IN_PROGRESS: 'success',
  COMPLETED: 'read_only',
  CANCELLED: 'read_only',
};

const TASK_STATUS_LABEL: Record<SofiaCrmTask['status'], string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const TASK_TYPE_LABEL: Record<SofiaCrmTask['type'], string> = {
  TASK: 'Tarea',
  FOLLOW_UP: 'Seguimiento',
};

const TASK_PRIORITY_LABEL: Record<SofiaCrmTask['priority'], string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

const TASK_PRIORITY_BADGE_TONE: Record<SofiaCrmTask['priority'], 'neutral' | 'info' | 'warning' | 'danger'> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

function isOverdue(task: SofiaCrmTask): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

export function TaskRow({ task }: { task: SofiaCrmTask }) {
  const updateTask = useSofiaCrmUpdateTask();
  const overdue = isOverdue(task);

  function transition(status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
    updateTask.mutate({
      taskId: task.id,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: task.version,
      status,
    });
  }

  const canStart = task.status === 'OPEN';
  const canComplete = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
  const canCancel = task.status === 'OPEN' || task.status === 'IN_PROGRESS';

  return (
    <Card data-testid={`sofia-crm-tasks-row-${task.id}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-bold text-ink" data-testid="sofia-crm-tasks-row-title">
              {task.title}
            </h3>
            <StatusBadge tone={TASK_STATUS_TONE[task.status]} label={TASK_STATUS_LABEL[task.status]} />
            <Badge tone="neutral">{TASK_TYPE_LABEL[task.type]}</Badge>
            <Badge tone={TASK_PRIORITY_BADGE_TONE[task.priority]}>{TASK_PRIORITY_LABEL[task.priority]}</Badge>
            {overdue ? <StatusBadge tone="warning" label="Vencida" data-testid={`sofia-crm-tasks-overdue-${task.id}`} /> : null}
          </div>

          {task.sanitizedDescription ? (
            <p className="mt-2 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2 text-[12.5px] leading-5.5 text-stone-700">
              {task.sanitizedDescription}
            </p>
          ) : null}

          <p className="mt-2 text-[11.5px] text-stone-600">
            Cliente: <span className="font-semibold text-stone-700">{task.customer.displayName ?? task.customerId}</span>
            {task.lead ? (
              <>
                {' '}
                · Lead: <span className="font-semibold text-stone-700">{task.lead.title}</span>
              </>
            ) : null}
            {task.assignedTo ? (
              <>
                {' '}
                · Asignada a: <span className="font-semibold text-stone-700">{task.assignedTo.fullName}</span>
                {!task.assignedTo.isActive ? ' (inactivo)' : ''}
              </>
            ) : (
              ' · Sin asignar'
            )}
          </p>

          <p className="mt-1 text-[11px] text-stone-500">
            {task.dueAt ? `Vence ${formatDateTime(task.dueAt)}` : 'Sin fecha de vencimiento'} · Creada {formatDateTime(task.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {canStart ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={updateTask.isPending}
              onClick={() => transition('IN_PROGRESS')}
              data-testid={`sofia-crm-tasks-start-${task.id}`}
            >
              Iniciar
            </Button>
          ) : null}
          {canComplete ? (
            <Button
              type="button"
              size="sm"
              disabled={updateTask.isPending}
              onClick={() => transition('COMPLETED')}
              data-testid={`sofia-crm-tasks-complete-${task.id}`}
            >
              Completar
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={updateTask.isPending}
              onClick={() => transition('CANCELLED')}
              data-testid={`sofia-crm-tasks-cancel-${task.id}`}
            >
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {updateTask.isError ? (
        <p className="mt-2 text-[11px] leading-5 text-red-700" data-testid={`sofia-crm-tasks-update-error-${task.id}`}>
          {updateTask.error instanceof ApiError ? updateTask.error.message : 'No se pudo actualizar la tarea.'}
        </p>
      ) : null}
    </Card>
  );
}
