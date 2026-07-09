'use client';

import { useState, type ComponentProps } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';

export function CancelOrderButton({
  disabled,
  isPending,
  onConfirm,
}: {
  disabled: boolean;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Cancelar pedido
      </Button>
      <ConfirmDialog
        open={open}
        title="Cancelar pedido"
        message="Esta acción descartará todos los productos cargados en esta comanda. No se puede deshacer."
        confirmLabel={isPending ? 'Cancelando...' : 'Sí, cancelar comanda'}
        destructive
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export function CheckoutOrderButton({
  disabled,
  isPending,
  orderTotal,
  onConfirm,
  ...rest
}: ComponentProps<typeof Button> & {
  disabled: boolean;
  isPending: boolean;
  orderTotal: number;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        {...rest}
      >
        {isPending ? 'Cobrando...' : 'Cobrar y cerrar'}
      </Button>
      <ConfirmDialog
        open={open}
        title="Cobrar y cerrar"
        message={`El total a cobrar es ${formatCurrency(orderTotal)}. ¿Confirmas el cierre de esta comanda? Una vez cobrada, la venta queda registrada y solo puede revertirse desde Caja.`}
        confirmLabel={isPending ? 'Cobrando...' : 'Sí, cobrar y cerrar'}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
