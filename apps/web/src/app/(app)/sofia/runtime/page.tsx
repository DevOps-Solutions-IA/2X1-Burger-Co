'use client';

import Link from 'next/link';
import { ArrowUpRight, Radio } from 'lucide-react';
import { useSofiaReadiness } from '@/features/sofia/queries';
import { ReadinessChecklist } from '@/features/sofia/runtime/ReadinessChecklist';
import { OperatorWorkspaceFrame, QueryStateBoundary, StatusBadge, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaRuntimePage() {
  const readiness = useSofiaReadiness();

  return (
    <OperatorWorkspaceFrame>
      <QueryStateBoundary
        isLoading={readiness.isLoading}
        isError={readiness.isError}
        error={readiness.error}
        data={readiness.data}
        loadingLabel="Cargando readiness de producción…"
        errorTitle="No se pudo cargar el readiness"
        data-testid="sofia-runtime"
      >
        {(data) => (
          <div className="space-y-4" data-testid="sofia-runtime-page">
            <WorkspaceHeader
              eyebrow="Runtime / Seguridad"
              title="Readiness y bloqueadores"
              description="Operación segura: producción bloqueada hasta completar las validaciones pendientes."
              statusBadges={<StatusBadge tone="blocked" label="Producción bloqueada" />}
              data-testid="sofia-runtime-hero"
            />

            <ReadinessChecklist readiness={data} />

            {(data.blockers.length > 0 || data.warnings.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.blockers.length > 0 && (
                  <div className="rounded-[1.15rem] border border-red-200 bg-red-50 p-3.5" data-testid="sofia-runtime-blockers">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-red-700">Bloqueadores</p>
                    <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-red-800">
                      {data.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.warnings.length > 0 && (
                  <div className="rounded-[1.15rem] border border-amber-200 bg-amber-50 p-3.5" data-testid="sofia-runtime-warnings">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-700">Precauciones</p>
                    <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-amber-800">
                      {data.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <Link
              href="/sofia/whatsapp-qr"
              className="group flex items-center justify-between rounded-[1.15rem] border border-stone-200 bg-white p-3.5 text-[13px] font-semibold text-stone-700 transition-colors hover:border-sofia-200"
              data-testid="sofia-runtime-whatsapp-link"
            >
              <span className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-stone-400" />
                Ver vinculación de WhatsApp
              </span>
              <ArrowUpRight className="h-4 w-4 text-stone-400 group-hover:text-sofia-600" />
            </Link>
          </div>
        )}
      </QueryStateBoundary>
    </OperatorWorkspaceFrame>
  );
}
