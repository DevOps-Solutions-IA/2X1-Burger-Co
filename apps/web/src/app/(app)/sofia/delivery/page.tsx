import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaDeliveryPage() {
  return (
    <PendingPhasePage
      eyebrow="Domicilios"
      title="Domicilios"
      description="Estado canónico de entrega y notificaciones asociadas."
      pendingPhase="Fase J — Domicilios y notificaciones"
      noticeTitle="Este panel no tiene ningún endpoint que consultar todavía"
      noticeDescription="El servicio de workflow de domicilios de SOFIA (delivery-workflow.service.ts) ya existe en el backend, pero al igual que Comandos, no tiene ningún controller HTTP expuesto. No hay endpoint que este panel pueda consultar hasta que se construya en la Fase J."
      data-testid="sofia-delivery-page"
    />
  );
}
