import { Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { SofiaDashboardSummary } from '@/features/sofia/contracts';

type CountGroup = SofiaDashboardSummary['safetyGuard']['real'];

const GROUP_LABELS: Array<{ key: 'real' | 'sandbox' | 'historical'; label: string }> = [
  { key: 'real', label: 'Real' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'historical', label: 'Histórico' },
];

function GroupRow({ label, group }: { label: string; group: CountGroup }) {
  return (
    <div className="rounded-[0.9rem] bg-stone-50 px-3 py-2.5" data-testid={`sofia-safety-guard-group-${label.toLowerCase()}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">{label}</p>
      <div className="mt-1.5 grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-[15px] font-bold text-emerald-700">{group.approvedCount}</p>
          <p className="text-[10px] font-medium text-stone-600">Aprobadas</p>
        </div>
        <div>
          <p className="text-[15px] font-bold text-amber-700">{group.humanRequiredCount}</p>
          <p className="text-[10px] font-medium text-stone-600">Humano</p>
        </div>
        <div>
          <p className="text-[15px] font-bold text-red-700">{group.blockedCount}</p>
          <p className="text-[10px] font-medium text-stone-600">Bloqueadas</p>
        </div>
        <div>
          <p className="text-[15px] font-bold text-stone-700">{group.draftCount}</p>
          <p className="text-[10px] font-medium text-stone-600">Borrador</p>
        </div>
      </div>
    </div>
  );
}

export function OverviewSafetyGuardPanel({ safetyGuard }: { safetyGuard: SofiaDashboardSummary['safetyGuard'] }) {
  return (
    <Card data-testid="sofia-overview-safety-guard-panel">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[0.65rem] bg-brand-100 text-brand-700">
          <Gauge className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">SafetyGuard</p>
          <h3 className="text-[14px] font-semibold text-ink">Decisiones por alcance</h3>
        </div>
      </div>

      <div className="mt-3.5 space-y-2">
        {GROUP_LABELS.map(({ key, label }) => (
          <GroupRow key={key} label={label} group={safetyGuard[key]} />
        ))}
      </div>
    </Card>
  );
}
