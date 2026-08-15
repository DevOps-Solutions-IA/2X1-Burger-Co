import { Brain } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaDashboardSummary } from '@/features/sofia/contracts';

export function OverviewAiPanel({ ai }: { ai: SofiaDashboardSummary['ai'] }) {
  return (
    <Card data-testid="sofia-overview-ai-panel">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[0.65rem] bg-brand-100 text-brand-700">
          <Brain className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Inteligencia artificial</p>
          <h3 className="text-[14px] font-semibold text-ink">{ai.aiProvider}</h3>
        </div>
      </div>

      <div className="mt-3.5 space-y-1.5">
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Modo</span>
          <span className="text-[12px] font-semibold text-ink">{ai.aiMode}</span>
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">DeepSeek</span>
          <StatusBadge
            tone={ai.deepSeekEnabled ? (ai.dryRunEnabled ? 'pending' : 'warning') : 'read_only'}
            label={ai.deepSeekEnabled ? (ai.dryRunEnabled ? 'Dry-run' : 'Activo') : 'Desactivado'}
            withDot={false}
          />
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Proveedor externo</span>
          <StatusBadge tone={ai.externalProviderEnabled ? 'warning' : 'blocked'} label={ai.externalProviderEnabled ? 'Habilitado' : 'Bloqueado'} withDot={false} />
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Fallback</span>
          <span className="text-[12px] font-semibold text-ink">{ai.fallbackProvider}</span>
        </div>
      </div>
    </Card>
  );
}
