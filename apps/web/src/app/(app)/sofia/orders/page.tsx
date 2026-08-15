import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaOrdersPage() {
  return (
    <PendingPhasePage
      eyebrow="Pedidos"
      title="Pedidos"
      description="Pedidos generados desde conversaciones, con orquestación canónica de backend."
      pendingPhase="Fase H — Checkout y pedidos"
      noticeTitle="Falta la correlación con la conversación de SOFIA"
      noticeDescription="El controller de pedidos (orders.controller.ts) existe y expone varios endpoints reales, pero ninguno filtra por conversationId. No hay forma de responder '¿cuál es el pedido de esta conversación?' sin esa correlación en el backend, y construirla es parte de la Fase H."
      data-testid="sofia-orders-page"
    />
  );
}
