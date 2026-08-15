'use client';

import { Clock3 } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { parsePaymentAmount, parseReceivedAmount, sanitizeCurrencyInput } from './pos.helpers';
import type { PaymentMethod, PaymentRow } from './pos.types';

export function PosPaymentPanel({
  activeOrderId,
  payments,
  sortedPaymentMethods,
  paymentMethodMap,
  checkoutIssues,
  onPaymentMethodChange,
  onPaymentAmountChange,
  onReceivedAmountChange,
  onRemovePayment,
}: {
  activeOrderId: string | null;
  payments: PaymentRow[];
  sortedPaymentMethods: PaymentMethod[];
  paymentMethodMap: Map<string, PaymentMethod>;
  checkoutIssues: string[];
  onPaymentMethodChange: (index: number, paymentMethodId: string) => void;
  onPaymentAmountChange: (index: number, amount: string) => void;
  onReceivedAmountChange: (index: number, receivedAmount: string) => void;
  onRemovePayment: (index: number) => void;
}) {
  if (!activeOrderId) {
    return null;
  }

  return (
    <>
      <div className="mt-6 space-y-3" data-testid="pos-payment-panel">
        {payments.map((payment, index) => {
          const paymentMethod = paymentMethodMap.get(payment.paymentMethodId);
          const isCashPayment = paymentMethod?.code === 'cash';
          const receivedAmount = parseReceivedAmount(payment.receivedAmount);
          const changeAmount = Math.max(receivedAmount - parsePaymentAmount(payment.amount), 0);

          return (
            <div key={index} className="rounded-2xl border border-stone-200 bg-white p-3.5">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    {index === 0 ? 'Método de pago' : `Pago ${index + 1}`}
                  </p>
                  <Select
                    className="h-10 rounded-xl border-stone-200 bg-stone-50"
                    value={payment.paymentMethodId}
                    onChange={(event) => onPaymentMethodChange(index, event.target.value)}
                  >
                    <option value="">Selecciona método</option>
                    {sortedPaymentMethods.map((method) => (
                      <option key={method.id} value={method.id}>{method.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    {isCashPayment ? 'Aplicado' : 'Monto'}
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-right text-[14px] font-semibold tabular-nums text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100/50"
                    value={payment.amount}
                    onChange={(event) => onPaymentAmountChange(index, sanitizeCurrencyInput(event.target.value))}
                  />
                </div>
              </div>
              {isCashPayment ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Recibido</p>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-right text-[14px] font-semibold tabular-nums text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100/50"
                      value={payment.receivedAmount}
                      onChange={(event) => onReceivedAmountChange(index, sanitizeCurrencyInput(event.target.value))}
                    />
                  </div>
                  <div className="rounded-xl bg-stone-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Cambio</p>
                    <p className="mt-1.5 text-right text-[15px] font-bold tabular-nums text-ink">
                      {receivedAmount > 0 ? formatCurrency(changeAmount) : formatCurrency(0)}
                    </p>
                  </div>
                </div>
              ) : null}
              {payments.length > 1 ? (
                <button
                  type="button"
                  className="mt-3 text-[12px] font-medium text-stone-400 transition hover:text-danger"
                  onClick={() => onRemovePayment(index)}
                >
                  Quitar este pago
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {checkoutIssues.length ? (
        <div className="mt-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-5 w-5 text-amber-700" />
            <div className="space-y-1">
              {checkoutIssues.map((issue) => (
                <p key={issue} className="text-sm text-amber-900">
                  {issue}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
