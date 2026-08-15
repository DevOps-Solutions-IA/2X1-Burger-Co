'use client';

import { useSofiaAlerts, useSofiaGovernanceEvents } from '@/features/sofia/queries';
import { AuditEventsTimeline } from '@/features/sofia/audit/AuditEventsTimeline';
import { AuditAlertsList } from '@/features/sofia/audit/AuditAlertsList';
import { OperatorWorkspaceFrame, QueryStateBoundary, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaAuditPage() {
  const events = useSofiaGovernanceEvents();
  const alerts = useSofiaAlerts();

  return (
    <OperatorWorkspaceFrame>
      <div className="space-y-4" data-testid="sofia-audit-page">
        <WorkspaceHeader
          eyebrow="Auditoría"
          title="Trazabilidad operativa"
          description="Eventos de gobernanza y alertas del sistema, correlacionados sin exponer secretos ni PII."
          data-testid="sofia-audit-hero"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <QueryStateBoundary
            isLoading={events.isLoading}
            isError={events.isError}
            error={events.error}
            data={events.data}
            loadingLabel="Cargando eventos de gobernanza…"
            errorTitle="No se pudieron cargar los eventos"
            data-testid="sofia-audit-events-boundary"
          >
            {(data) => <AuditEventsTimeline events={data} />}
          </QueryStateBoundary>

          <QueryStateBoundary
            isLoading={alerts.isLoading}
            isError={alerts.isError}
            error={alerts.error}
            data={alerts.data}
            loadingLabel="Cargando alertas…"
            errorTitle="No se pudieron cargar las alertas"
            data-testid="sofia-audit-alerts-boundary"
          >
            {(data) => <AuditAlertsList alerts={data} />}
          </QueryStateBoundary>
        </div>
      </div>
    </OperatorWorkspaceFrame>
  );
}
