'use client';

import Link from 'next/link';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { DataTableShell, type DataTableColumn, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import type { CrmTask } from './contracts';
import { customerName } from './labels';
import { useCrmTasks } from './queries';

const columns: DataTableColumn<CrmTask>[] = [
  { id: 'work', header: 'Acción de recuperación', cell: (row) => <div><p className="font-semibold">{row.title}</p><p className="mt-1 text-xs text-muted">{row.sanitizedDescription || 'Sin descripción adicional'}</p></div> },
  { id: 'customer', header: 'Cliente', cell: (row) => customerName(row.customer.displayName) },
  { id: 'priority', header: 'Prioridad', cell: (row) => <StatusBadge status={row.priority} tone={row.priority === 'URGENT' ? 'danger' : 'warning'} /> },
  { id: 'status', header: 'Estado', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'due', header: 'Vence', cell: (row) => <span className="text-xs text-muted">{formatDateTime(row.dueAt)}</span> },
];

export function RecoveryView() {
  const tasks = useCrmTasks({ type: 'FOLLOW_UP' });
  const recovery = tasks.data?.data.filter((task) => task.customerServiceCaseId !== null) ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-signal-warning/30 bg-signal-warning/10 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex max-w-3xl items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-signal-warning" /><div><h2 className="font-heading text-lg font-bold text-ink">Recuperación gobernada</h2><p className="mt-1 text-sm leading-6 text-ink">Las quejas y resoluciones permanecen en Customer Service. CRM organiza seguimiento, pero no autoriza reembolsos, descuentos, cupones ni reemplazos.</p></div></div><Button asChild variant="secondary"><Link href="/customer-service">Abrir casos <ArrowRight className="h-4 w-4" /></Link></Button></div>
      </section>
      {tasks.isPending ? <QueryState status="loading" title="Consultando seguimientos de recuperación" /> : tasks.error ? <QueryState status="error" onRetry={() => void tasks.refetch()} /> : recovery.length === 0 ? <QueryState status="empty" title="Sin seguimientos de recuperación" description="No existen follow-ups vinculados a casos de servicio en esta página." action={<Button asChild variant="secondary"><Link href="/customer-service">Revisar casos abiertos</Link></Button>} /> : <DataTableShell rows={recovery} columns={columns} rowKey={(row) => row.id} caption="Seguimientos CRM vinculados a recuperación" density="compact" />}
    </div>
  );
}
