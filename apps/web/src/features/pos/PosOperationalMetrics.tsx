'use client';

import { ReceiptText, ShoppingCart, Store, WalletCards } from 'lucide-react';
import { MetricCard } from '@/components/ui/metric-card';
import { formatCurrency, formatNumber } from '@/lib/format';

type PosOperationalMetricsProps = {
  isCashOpen: boolean;
  activeOrdersCount: number;
  occupiedTablesCount: number;
  saleTotal: number;
  hasActiveOrder: boolean;
};

export function PosOperationalMetrics({
  isCashOpen,
  activeOrdersCount,
  occupiedTablesCount,
  saleTotal,
  hasActiveOrder,
}: PosOperationalMetricsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        compact
        label="Caja"
        value={isCashOpen ? 'Abierta' : 'Cerrada'}
        hint={isCashOpen ? 'Lista para operar' : 'Abre caja antes de vender'}
        icon={<WalletCards className="h-5 w-5" />}
        accent={isCashOpen ? 'success' : 'danger'}
      />
      <MetricCard
        compact
        label="Comandas"
        value={`${formatNumber(activeOrdersCount)} abiertas`}
        hint="Pedidos en curso"
        icon={<ReceiptText className="h-5 w-5" />}
        accent="brand"
      />
      <MetricCard
        compact
        label="Mesas ocupadas"
        value={formatNumber(occupiedTablesCount)}
        hint="Mesas con consumo en sala"
        icon={<Store className="h-5 w-5" />}
        accent="ink"
      />
      <MetricCard
        compact
        label="Total actual"
        value={formatCurrency(saleTotal)}
        hint={hasActiveOrder ? 'Subtotal de la comanda activa' : 'Total del borrador actual'}
        icon={<ShoppingCart className="h-5 w-5" />}
        accent="success"
      />
    </div>
  );
}
