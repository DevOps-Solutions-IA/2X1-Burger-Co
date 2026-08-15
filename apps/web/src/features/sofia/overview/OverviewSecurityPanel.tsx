import { ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusBadge, toneFromCheckStatus } from '@/components/sofia/workspace';
import type { SofiaDashboardSummary } from '@/features/sofia/contracts';
import { humanizeCrmCode } from '@/features/sofia/crm-display';

function checkStatusFor(security: SofiaDashboardSummary['security'], code: string): 'PASS' | 'WARNING' | 'BLOCKED' {
  if (security.blockedChecks.includes(code)) return 'BLOCKED';
  if (security.pendingChecks.includes(code)) return 'WARNING';
  return 'PASS';
}

export function OverviewSecurityPanel({ security }: { security: SofiaDashboardSummary['security'] }) {
  const allChecks = [...security.passedChecks, ...security.pendingChecks, ...security.blockedChecks];
  const uniqueChecks = Array.from(new Set(allChecks));

  return (
    <Card data-testid="sofia-overview-security-panel">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[0.65rem] bg-sofia-100 text-sofia-700">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Seguridad operativa</p>
          <h3 className="text-[14px] font-semibold text-ink">Readiness de producción</h3>
        </div>
      </div>

      <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Rotación de secretos</span>
          <span className="text-[12px] font-semibold text-ink">{humanizeCrmCode(security.secretRotationStatus)}</span>
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Limpieza de seguridad</span>
          <span className="text-[12px] font-semibold text-ink">{humanizeCrmCode(security.securityCleanupStatus)}</span>
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Allowlist comercial</span>
          <span className="text-[12px] font-semibold text-ink">{humanizeCrmCode(security.allowlistFinalStatus)}</span>
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Readiness de producción</span>
          <span className="text-[12px] font-semibold text-ink">{humanizeCrmCode(security.productionReadinessStatus)}</span>
        </div>
      </div>

      {uniqueChecks.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5" data-testid="sofia-overview-security-checks">
          {uniqueChecks.map((code) => (
            <StatusBadge key={code} tone={toneFromCheckStatus(checkStatusFor(security, code))} label={humanizeCrmCode(code)} />
          ))}
        </div>
      )}
    </Card>
  );
}
