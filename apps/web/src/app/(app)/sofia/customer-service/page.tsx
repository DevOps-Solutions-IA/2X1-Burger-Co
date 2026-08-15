import { CasesListView } from '@/features/sofia/customer-service/CasesListView';
import { OperatorWorkspaceFrame, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaCustomerServicePage() {
  return (
    <OperatorWorkspaceFrame>
      <div className="space-y-4" data-testid="sofia-customer-service-page">
        <WorkspaceHeader
          eyebrow="Servicio al cliente"
          title="Casos de servicio al cliente"
          description="Casos reales con máquina de estados lineal y transición operada por el humano desde el panel admin."
        />
        <CasesListView />
      </div>
    </OperatorWorkspaceFrame>
  );
}
