import { Card } from '@/components/ui/card';
import { StatusBadge, toneFromCheckStatus } from '@/components/sofia/workspace';
import type { SofiaReadiness } from '@/features/sofia/contracts';

export function ReadinessChecklist({ readiness }: { readiness: SofiaReadiness }) {
  const passCount = readiness.checklist.filter((item) => item.status === 'PASS').length;

  return (
    <Card className="space-y-3" data-testid="sofia-readiness-checklist">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Preparación para preproducción</p>
          <h2 className="text-[15px] font-semibold text-ink">
            {passCount} de {readiness.checklist.length} validaciones completadas
          </h2>
        </div>
        <StatusBadge tone={toneFromCheckStatus(readiness.status)} label={readiness.status} />
      </div>

      <p className="rounded-[0.9rem] bg-brand-50 px-3 py-2.5 text-[12px] font-medium text-brand-900">{readiness.nextRequiredAction}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {readiness.checklist.map((item) => (
          <div key={item.key} className="rounded-[0.9rem] border border-stone-100 bg-stone-50/70 px-3 py-2.5" data-testid={`sofia-readiness-item-${item.key}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-ink">{item.label}</p>
              <StatusBadge tone={toneFromCheckStatus(item.status)} label={item.status} />
            </div>
            <p className="mt-1 text-[11px] font-medium text-stone-600">{item.reason}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
