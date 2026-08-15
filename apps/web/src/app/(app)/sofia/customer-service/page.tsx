import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaCustomerServicePage() {
  return (
    <PendingPhasePage
      eyebrow="Servicio al cliente"
      title="Servicio al cliente"
      description="Casos de servicio al cliente y autoridad de recuperación gobernada."
      pendingPhase="Fase K — Servicio al cliente"
      noticeTitle="Servicio al cliente disponible en una fase posterior"
      noticeDescription="Los casos de servicio al cliente y la autoridad de recuperación gobernada se conectan en la Fase K del programa."
      data-testid="sofia-customer-service-page"
    />
  );
}
