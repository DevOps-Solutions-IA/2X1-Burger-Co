import { OperatorWorkspaceFrame } from './OperatorWorkspaceFrame';
import { PhaseBoundaryNotice } from './PhaseBoundaryNotice';
import { StatusBadge } from './StatusBadge';
import { WorkspaceHeader } from './WorkspaceHeader';

/**
 * Página completa para una sección del workspace operativo cuya capacidad
 * todavía no está conectada a datos reales. Usada por las secciones sin
 * endpoint HTTP o correlación de backend disponible (Comandos, Pedidos,
 * Domicilios).
 */
export function PendingPhasePage({
  eyebrow,
  title,
  description,
  pendingPhase,
  noticeTitle,
  noticeDescription,
  'data-testid': testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  pendingPhase: string;
  noticeTitle: string;
  noticeDescription: string;
  'data-testid'?: string;
}) {
  return (
    <OperatorWorkspaceFrame>
      <div className="space-y-4" data-testid={testId}>
        <WorkspaceHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          statusBadges={<StatusBadge tone="pending" label={pendingPhase} />}
        />
        <PhaseBoundaryNotice title={noticeTitle} description={noticeDescription} pendingPhase={pendingPhase} />
      </div>
    </OperatorWorkspaceFrame>
  );
}
