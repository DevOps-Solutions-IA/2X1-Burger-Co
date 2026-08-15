import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaPaymentsPage() {
  return (
    <PendingPhasePage
      eyebrow="Pagos"
      title="Pagos"
      description="Estado financiero autoritativo, incluyendo resultados desconocidos y revisión."
      pendingPhase="Fase I — Pagos"
      noticeTitle="Pagos disponibles en una fase posterior"
      noticeDescription="La orquestación de pagos, incluyendo el estado UNKNOWN_RESULT y revisión financiera, se conecta en la Fase I del programa."
      data-testid="sofia-payments-page"
    />
  );
}
