import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, toneFromAlertSeverity } from '@/components/sofia/workspace';
import type { SofiaAlerts } from '@/features/sofia/contracts';

export function AuditAlertsList({ alerts }: { alerts: SofiaAlerts }) {
  const openAlerts = alerts.filter((alert) => alert.status === 'OPEN');

  return (
    <Card data-testid="sofia-audit-alerts">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">Alertas</p>
          <h2 className="text-[15px] font-semibold text-ink">{openAlerts.length} abiertas</h2>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div className="mt-3 space-y-2">
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-[0.9rem] border border-stone-100 bg-stone-50/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-semibold text-ink">{alert.title}</p>
                <StatusBadge tone={toneFromAlertSeverity(alert.severity)} label={alert.severity} />
              </div>
              <p className="mt-1 text-[11.5px] font-medium text-stone-500">{alert.message}</p>
              <p className="mt-1 text-[10.5px] font-medium text-stone-400">
                {alert.status} · {new Date(alert.createdAt).toLocaleString('es-CO')}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState title="Sin alertas" description="No hay alertas abiertas ni resueltas en este momento." />
        </div>
      )}
    </Card>
  );
}
