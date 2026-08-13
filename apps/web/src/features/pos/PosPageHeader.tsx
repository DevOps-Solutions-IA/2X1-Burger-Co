'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/product';

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
    <PageHeader
      eyebrow="Operación de venta"
      title="Punto de venta"
      description="Abre, atiende y cobra comandas desde un espacio operativo único."
      status={
        <Badge tone={hasActiveOrder ? 'info' : 'success'}>{hasActiveOrder ? 'Pedido en curso' : 'Nueva comanda'}</Badge>
      }
      actions={
        <Button
          type="button"
          variant={hasActiveOrder || hasDraft ? 'secondary' : 'default'}
          onClick={onNewOrder}
          className="w-full sm:w-auto"
        >
          Nueva comanda
        </Button>
      }
    />
  );
}
