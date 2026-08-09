'use client';

import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import { formatReceiptNumber } from '@/lib/receipt-number';
import type { ThermalReceiptData } from '@/lib/thermal-receipt';

type PosLastReceiptPanelProps = {
  receipt: ThermalReceiptData | null;
  onPrint: (receipt: ThermalReceiptData) => void | Promise<void>;
  onClose: () => void;
};

export function PosLastReceiptPanel({
  receipt,
  onPrint,
  onClose,
}: PosLastReceiptPanelProps) {
  if (!receipt) {
    return null;
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-stone-200 bg-white p-4" data-testid="pos-last-receipt-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink">{formatReceiptNumber(receipt.saleNumber)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-ink">{formatCurrency(receipt.total)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-w-0"
          onClick={() => onPrint(receipt)}
        >
          Imprimir
        </Button>
        <Button type="button" size="sm" variant="secondary" className="min-w-0" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
