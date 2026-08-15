import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaDeliveryPage() {
  return (
    <PendingPhasePage
      eyebrow="Domicilios"
      title="Domicilios"
      description="Estado canónico de entrega y notificaciones asociadas."
      pendingPhase="Fase J — Domicilios y notificaciones"
      noticeTitle="Domicilios disponibles en una fase posterior"
      noticeDescription="El estado canónico de entrega y las notificaciones asociadas se conectan en la Fase J del programa."
      data-testid="sofia-delivery-page"
    />
  );
}
