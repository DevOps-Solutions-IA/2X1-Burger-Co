'use client';

import { ReceiptText, ShoppingCart, Store, WalletCards } from 'lucide-react';
import { MetricSurface } from '@/components/product';
import { formatCurrency, formatNumber } from '@/lib/format';

type PosOperationalMetricsProps = {
  isCashOpen: boolean;
  activeOrdersCount: number;
  occupiedTablesCount: number;
  saleTotal: number;
  hasActiveOrder: boolean;
  activeOrdersUnavailable?: boolean;
  occupiedTablesUnavailable?: boolean;
  cashUnavailable?: boolean;
};

export function PosOperationalMetrics({
  isCashOpen,
  activeOrdersCount,
  occupiedTablesCount,
  saleTotal,
  hasActiveOrder,
  activeOrdersUnavailable = false,
  occupiedTablesUnavailable = false,
  cashUnavailable = false,
}: PosOperationalMetricsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricSurface
        density="compact"
        label="Caja"
        value={isCashOpen ? 'Abierta' : 'Cerrada'}
        context={isCashOpen ? 'Lista para operar' : 'Abre caja antes de vender'}
        icon={<WalletCards className="h-5 w-5" />}
        unavailable={cashUnavailable}
      />
      <MetricSurface
        density="compact"
        label="Comandas"
        value={`${formatNumber(activeOrdersCount)} abiertas`}
        context="Pedidos en curso"
        icon={<ReceiptText className="h-5 w-5" />}
        unavailable={activeOrdersUnavailable}
      />
      <MetricSurface
        density="compact"
        label="Mesas ocupadas"
        value={formatNumber(occupiedTablesCount)}
        context="Mesas con consumo en sala"
        icon={<Store className="h-5 w-5" />}
        unavailable={occupiedTablesUnavailable}
      />
      <MetricSurface
        density="compact"
        label="Total actual"
        value={formatCurrency(saleTotal)}
        context={hasActiveOrder ? 'Subtotal de la comanda activa' : 'Total del borrador actual'}
        icon={<ShoppingCart className="h-5 w-5" />}
      />
    </div>
  );
}
