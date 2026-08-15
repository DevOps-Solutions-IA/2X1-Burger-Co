'use client';

import { Button } from '@/components/ui/button';
import { CancelOrderButton, CheckoutOrderButton } from './PosOrderActions';

type PosOrderCommitActionsProps = {
  hasCartItems: boolean;
  hasActiveOrder: boolean;
  orderIssues: string[];
  checkoutIssues: string[];
  savePending: boolean;
  cancelPending: boolean;
  checkoutPending: boolean;
  orderTotal: number;
  onResetWorkspace: () => void;
  onSaveOrder: () => void;
  onCancelOrder: () => void;
  onCheckoutOrder: () => void;
};

export function PosOrderCommitActions({
  hasCartItems,
  hasActiveOrder,
  orderIssues,
  checkoutIssues,
  savePending,
  cancelPending,
  checkoutPending,
  orderTotal,
  onResetWorkspace,
  onSaveOrder,
  onCancelOrder,
  onCheckoutOrder,
}: PosOrderCommitActionsProps) {
  return (
    <div className="mt-6 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" variant="ghost" className="w-full font-bold" onClick={onResetWorkspace}>
          Limpiar
        </Button>
        <Button
          type="button"
          className="w-full font-bold"
          disabled={!hasCartItems || orderIssues.length > 0 || savePending}
          onClick={onSaveOrder}
          data-testid="pos-delivery-save"
        >
          {savePending ? 'Guardando...' : hasActiveOrder ? 'Guardar' : 'Abrir pedido'}
        </Button>
      </div>
      <CancelOrderButton
        disabled={!hasActiveOrder || cancelPending}
        isPending={cancelPending}
        onConfirm={onCancelOrder}
      />
      {hasActiveOrder ? (
        <div data-testid="pos-checkout-button">
          <CheckoutOrderButton
            data-testid="pos-checkout-order"
            className="w-full"
            disabled={checkoutIssues.length > 0 || checkoutPending}
            isPending={checkoutPending}
            orderTotal={orderTotal}
            onConfirm={onCheckoutOrder}
          />
        </div>
      ) : null}
    </div>
  );
}
