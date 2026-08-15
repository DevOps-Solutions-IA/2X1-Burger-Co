import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaOrdersPage() {
  return (
    <PendingPhasePage
      eyebrow="Pedidos"
      title="Pedidos"
      description="Pedidos generados desde conversaciones, con orquestación canónica de backend."
      pendingPhase="Fase H — Checkout y pedidos"
      noticeTitle="Pedidos disponibles en una fase posterior"
      noticeDescription="La orquestación de checkout y pedidos canónicos se conecta en la Fase H del programa."
      data-testid="sofia-orders-page"
    />
  );
}
