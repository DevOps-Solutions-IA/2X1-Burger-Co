'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrency, formatNumber } from '@/lib/format';
import { sanitizeCurrencyInput } from './pos.helpers';
import type { CartItem, OrderType } from './pos.types';

export function PosCartPanel({
  cart,
  baseSaleTotal,
  paymentTotal,
  difference,
  orderType,
  deliveryFeeValue,
  deliveryZoneValue,
  manualSaleTotal,
  onManualSaleTotalChange,
  onResetManualSaleTotal,
  onUpdateQuantity,
  onUpdateItemPrice,
  onNormalizeItemPriceInput,
}: {
  cart: CartItem[];
  baseSaleTotal: number;
  paymentTotal: number;
  difference: number;
  orderType: OrderType;
  deliveryFeeValue: number;
  deliveryZoneValue: string;
  manualSaleTotal: string;
  onManualSaleTotalChange: (value: string) => void;
  onResetManualSaleTotal: () => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateItemPrice: (productId: string, value: string) => void;
  onNormalizeItemPriceInput: (productId: string) => void;
}) {
  return (
    <>
      <div className="mt-5 flex-1 space-y-2" data-testid="pos-cart-panel">
        {cart.map((item) => (
          <div key={item.productId} className="group overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-3 shadow-sm transition hover:border-stone-300 hover:shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13px] font-bold text-ink">{item.name}</p>
                  {item.kind === 'DIRECT_STOCK' && item.stock <= 3 ? (
                    <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">Queda {formatNumber(item.stock)}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-stone-400">{item.categoryName} · {item.code}</p>
              </div>
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                onClick={() => onUpdateQuantity(item.productId, 0)}
                aria-label={`Quitar ${item.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2.5 flex items-end justify-between gap-3">
              <div className="inline-flex min-h-11 items-center rounded-xl border border-stone-200 bg-stone-50 p-0.5">
                <button type="button" aria-label={`Reducir cantidad de ${item.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100" onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}>
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-8 text-center text-[13px] font-bold tabular-nums text-ink" data-testid={`pos-cart-qty-${item.code.toLowerCase()}`}>
                  {item.quantity}
                </span>
                <button type="button" aria-label={`Aumentar cantidad de ${item.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100" onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}>
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-stone-400">Unitario</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`Precio de ${item.name}`}
                    className="mt-0.5 h-11 w-[6.25rem] rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-right text-base font-semibold tabular-nums text-ink transition focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
                    value={item.priceInput}
                    onChange={(event) => onUpdateItemPrice(item.productId, event.target.value)}
                    onBlur={() => onNormalizeItemPriceInput(item.productId)}
                  />
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-stone-400">Subtotal</p>
                  <p className="mt-0.5 min-w-[5rem] text-[15px] font-bold tabular-nums text-ink">
                    {formatCurrency(item.price * item.quantity)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}

        {!cart.length ? (
          <div className="flex min-h-[12rem] items-center">
            <EmptyState
              title="Cargá productos desde el catálogo para empezar."
              description="Agrega productos para empezar a operar."
            />
          </div>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-2xl border border-brand-200/60 bg-brand-50/40 p-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-500">Subtotal</p>
              <p className="mt-2 text-[18px] font-extrabold tabular-nums text-brand-700">{formatCurrency(baseSaleTotal)}</p>
            </div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-500">Pagado</p>
              <p className="mt-2 text-[18px] font-extrabold tabular-nums text-ink">{formatCurrency(paymentTotal)}</p>
            </div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-500">Diferencia</p>
              <p className={`mt-2 text-[18px] font-extrabold tabular-nums ${difference === 0 ? 'text-emerald-600' : difference > 0 ? 'text-brand-600' : 'text-red-600'}`}>
                {formatCurrency(difference)}
              </p>
            </div>
          </div>
          {orderType === 'DELIVERY' ? (
            <div className="mt-3 border-t border-stone-200 pt-3 text-center">
              <p className="text-[11px] text-stone-500">
                Domicilio: {formatCurrency(deliveryFeeValue)}
                {deliveryZoneValue ? ` · ${deliveryZoneValue}` : ''}
              </p>
            </div>
          ) : null}
        </div>
        {cart.length ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
                aria-label="Ajuste manual del total"
                className="h-11 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 text-right text-base font-semibold tabular-nums text-ink placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              value={manualSaleTotal}
              onChange={(event) => onManualSaleTotalChange(sanitizeCurrencyInput(event.target.value))}
              placeholder="Ajuste global"
            />
            {manualSaleTotal ? (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-stone-500 transition hover:bg-stone-100 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                onClick={onResetManualSaleTotal}
              >
                Restablecer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
