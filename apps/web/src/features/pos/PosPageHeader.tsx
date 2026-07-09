'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/section-title';

type PosPageHeaderProps = {
  hasActiveOrder: boolean;
  hasDraft: boolean;
  onNewOrder: () => void;
};

export function PosPageHeader({
  hasActiveOrder,
  hasDraft,
  onNewOrder,
}: PosPageHeaderProps) {
  return (
    <SectionTitle
      eyebrow="Venta en marcha"
      title="POS — 2X1 Burger Co"
      description="Abrí, atendé y cobrá pedidos sin salir de esta pantalla."
      status={
        <Badge tone={hasActiveOrder ? 'info' : 'success'}>{hasActiveOrder ? 'Pedido en curso' : 'Nueva comanda'}</Badge>
      }
      actions={
        <Button
          type="button"
          variant={hasActiveOrder || hasDraft ? 'secondary' : 'default'}
          onClick={onNewOrder}
        >
          Nueva comanda
        </Button>
      }
    />
  );
}
