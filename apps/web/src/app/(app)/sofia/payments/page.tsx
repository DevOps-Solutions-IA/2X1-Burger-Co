import { OperatorWorkspaceFrame, StatusBadge, WorkspaceHeader } from '@/components/sofia/workspace';
import { PaymentsView } from '@/features/sofia/payments/PaymentsView';

export default function SofiaPaymentsPage() {
  return (
    <OperatorWorkspaceFrame>
      <div className="space-y-4" data-testid="sofia-payments-page">
        <WorkspaceHeader
          eyebrow="Pagos"
          title="Estado financiero de pagos"
          description="Observabilidad de solo lectura sobre intentos, enlaces, transiciones y webhooks de pago, incluyendo resultados desconocidos que requieren revisión financiera humana."
          statusBadges={<StatusBadge tone="read_only" label="Solo lectura" />}
          data-testid="sofia-payments-hero"
        />

        <PaymentsView />
      </div>
    </OperatorWorkspaceFrame>
  );
}
