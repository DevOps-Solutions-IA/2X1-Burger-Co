'use client';

import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, Contact, ListTodo, Tags, Workflow } from 'lucide-react';
import { MetricSurface, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { useCrmLeads, useCrmPipelines, useCrmSegments, useCrmTasks } from './queries';

export function CrmOverviewView() {
  const pipelines = useCrmPipelines('ACTIVE');
  const leads = useCrmLeads();
  const tasks = useCrmTasks({ type: 'TASK' });
  const openTasks = useCrmTasks({ type: 'TASK', status: 'OPEN' });
  const inProgressTasks = useCrmTasks({ type: 'TASK', status: 'IN_PROGRESS' });
  const followUps = useCrmTasks({ type: 'FOLLOW_UP' });
  const openFollowUps = useCrmTasks({ type: 'FOLLOW_UP', status: 'OPEN' });
  const inProgressFollowUps = useCrmTasks({ type: 'FOLLOW_UP', status: 'IN_PROGRESS' });
  const segments = useCrmSegments();
  const queries = [
    pipelines,
    leads,
    tasks,
    openTasks,
    inProgressTasks,
    followUps,
    openFollowUps,
    inProgressFollowUps,
    segments,
  ];
  const pending = queries.some((query) => query.isPending);
  const failed = queries.find((query) => query.error)?.error;

  if (pending) return <QueryState status="loading" title="Preparando el CRM" />;
  if (failed) {
    return <QueryState status="error" onRetry={() => queries.forEach((query) => void query.refetch())} />;
  }

  const openTaskCount = (openTasks.data?.pagination.total ?? 0) + (inProgressTasks.data?.pagination.total ?? 0);
  const dueFollowUpCount = (openFollowUps.data?.pagination.total ?? 0) + (inProgressFollowUps.data?.pagination.total ?? 0);
  const activeLeads = leads.data?.data.filter((lead) => !['WON', 'LOST', 'ARCHIVED'].includes(lead.status)).length ?? 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores reales del CRM">
        <MetricSurface label="Pipelines activos" value={pipelines.data?.pagination.total ?? 0} icon={<Workflow className="h-5 w-5" />} density="compact" />
        <MetricSurface label="Leads visibles" value={leads.data?.pagination.total ?? 0} context={`${activeLeads} activos en esta página`} icon={<Contact className="h-5 w-5" />} density="compact" />
        <MetricSurface label="Tareas abiertas" value={openTaskCount} context={`${tasks.data?.pagination.total ?? 0} tareas registradas`} icon={<ListTodo className="h-5 w-5" />} density="compact" />
        <MetricSurface label="Seguimientos abiertos" value={dueFollowUpCount} context={`${followUps.data?.pagination.total ?? 0} registrados`} icon={<BriefcaseBusiness className="h-5 w-5" />} density="compact" />
        <MetricSurface label="Segmentos" value={segments.data?.pagination.total ?? 0} icon={<Tags className="h-5 w-5" />} density="compact" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <article className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-800">Trabajo comercial</p>
              <h2 className="mt-1 font-heading text-xl font-bold text-ink">Próximas acciones reales</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Las tareas y seguimientos provienen del backend; un fallo nunca se reemplaza por un valor estimado.</p>
            </div>
            <Button asChild variant="secondary"><Link href="/crm/tasks">Abrir tareas <ArrowRight className="h-4 w-4" /></Link></Button>
          </div>
          <div className="mt-5 divide-y divide-line">
            {(tasks.data?.data ?? []).slice(0, 5).map((task) => (
              <div key={task.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{task.title}</p>
                  <p className="mt-1 text-xs text-muted">{task.customer.displayName || 'Cliente sin nombre confirmado'}</p>
                </div>
                <StatusBadge status={task.status} />
              </div>
            ))}
            {tasks.data?.data.length === 0 ? <p className="py-6 text-sm text-muted">No hay tareas registradas.</p> : null}
          </div>
        </article>

        <aside className="rounded-2xl border border-line bg-ink p-5 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-300">Límite operativo</p>
          <h2 className="mt-2 font-heading text-xl font-bold">Sin campañas automáticas</h2>
          <p className="mt-2 text-sm leading-6 text-stone-300">Este módulo organiza trabajo comercial y recuperación. No envía campañas, mensajes de WhatsApp ni promesas de compensación.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <StatusBadge status="BLOCKED" label="Outbound bloqueado" tone="warning" onDark />
            <StatusBadge status="ACTIVE" label="Historial auditable" tone="success" onDark />
          </div>
        </aside>
      </section>
    </div>
  );
}
