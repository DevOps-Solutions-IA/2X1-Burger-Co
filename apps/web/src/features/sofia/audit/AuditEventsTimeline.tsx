import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SofiaGovernanceEvents } from '@/features/sofia/contracts';
import { humanizeCrmCode } from '@/features/sofia/crm-display';

export function AuditEventsTimeline({ events }: { events: SofiaGovernanceEvents }) {
  return (
    <Card data-testid="sofia-audit-events">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">Gobernanza</p>
      <h2 className="text-[15px] font-semibold text-ink">Últimos eventos</h2>

      {events.length > 0 ? (
        <div className="mt-3 space-y-2">
          {events.map((event, index) => (
            <div key={`${event.type}-${event.createdAt}-${index}`} className="flex items-start justify-between gap-3 rounded-[0.9rem] bg-stone-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-ink">{humanizeCrmCode(event.type)}</p>
                <p className="mt-0.5 text-[11.5px] font-medium text-stone-500">{event.detail}</p>
              </div>
              <span className="shrink-0 text-[10.5px] font-medium text-stone-400">{new Date(event.createdAt).toLocaleString('es-CO')}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState title="Sin eventos registrados" description="Todavía no hay eventos de gobernanza para mostrar." />
        </div>
      )}
    </Card>
  );
}
