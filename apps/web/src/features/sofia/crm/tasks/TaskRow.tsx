'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Clock, PlayCircle, Repeat2, Target, User, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
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

function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return initials || '?';
}

function PersonChip({ icon, label, name, muted }: { icon: ReactNode; label: string; name: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white py-0.5 pl-0.5 pr-2.5 text-[11px] font-medium text-stone-700">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
          muted ? 'bg-stone-100 text-stone-500' : 'bg-brand-100 text-brand-800',
        )}
        aria-hidden="true"
      >
        {muted ? icon : initialsOf(name)}
      </span>
      <span className="sr-only">{label}:</span>
      {name}
    </span>
  );
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
    <Card
      className={cn(overdue && 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-200/70')}
      data-testid={`sofia-crm-tasks-row-${task.id}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
              task.type === 'FOLLOW_UP' ? 'border-sky-100 bg-sky-50 text-sky-700' : 'border-brand-100 bg-brand-50 text-brand-700',
            )}
            aria-hidden="true"
          >
            {task.type === 'FOLLOW_UP' ? <Repeat2 className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-bold leading-tight text-ink" data-testid="sofia-crm-tasks-row-title">
                {task.title}
              </h3>
              <StatusBadge tone={TASK_STATUS_TONE[task.status]} label={TASK_STATUS_LABEL[task.status]} />
              <Badge tone="neutral">{TASK_TYPE_LABEL[task.type]}</Badge>
              <Badge tone={TASK_PRIORITY_BADGE_TONE[task.priority]}>{TASK_PRIORITY_LABEL[task.priority]}</Badge>
              {overdue ? (
                <StatusBadge tone="warning" label="Vencida" data-testid={`sofia-crm-tasks-overdue-${task.id}`} />
              ) : null}
            </div>

            {task.sanitizedDescription ? (
              <p className="mt-2.5 rounded-xl border border-stone-100 bg-stone-50/70 px-3.5 py-2.5 text-[12.5px] leading-5.5 text-stone-700">
                {task.sanitizedDescription}
              </p>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <PersonChip icon={<User className="h-3 w-3" />} label="Cliente" name={task.customer.displayName ?? task.customerId} />
              {task.lead ? (
                <PersonChip icon={<Target className="h-3 w-3" />} label="Lead" name={task.lead.title} muted />
              ) : null}
              {task.assignedTo ? (
                <PersonChip
                  icon={<User className="h-3 w-3" />}
                  label="Asignada a"
                  name={task.assignedTo.isActive ? task.assignedTo.fullName : `${task.assignedTo.fullName} (inactivo)`}
                />
              ) : (
                <span className="inline-flex items-center rounded-full border border-dashed border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-500">
                  Sin asignar
                </span>
              )}
            </div>

            <p
              className={cn(
                'mt-2.5 flex items-center gap-1.5 text-[11.5px]',
                overdue ? 'font-semibold text-amber-800' : 'text-stone-500',
              )}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {task.dueAt ? `Vence ${formatDateTime(task.dueAt)}` : 'Sin fecha de vencimiento'}
              <span className="text-stone-400">· Creada {formatDateTime(task.createdAt)}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch lg:justify-end">
          {canStart ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={updateTask.isPending}
              onClick={() => transition('IN_PROGRESS')}
              data-testid={`sofia-crm-tasks-start-${task.id}`}
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
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
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
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
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {updateTask.isError ? (
        <p className="mt-3 text-[11px] leading-5 text-red-700" data-testid={`sofia-crm-tasks-update-error-${task.id}`}>
          {updateTask.error instanceof ApiError ? updateTask.error.message : 'No se pudo actualizar la tarea.'}
        </p>
      ) : null}
    </Card>
  );
}
