'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { CheckCircle2, Clock3, CreditCard, MessageCircle, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import { resolveApiUrl } from '@/lib/api';

type PaymentMethodCode = 'ONLINE' | 'NEQUI_MANUAL' | 'CASH';

type PublicPaymentOrder = {
  expired: boolean;
  orderReference: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryNeighborhood?: string | null;
  items?: Array<{ code: string; name: string; quantity: number; unitPrice: number; totalPrice: number; notes?: string | null }>;
  subtotal?: number; deliveryFee?: number; total?: number; currency?: string;
  orderStatus?: string; deliveryStatus?: string | null; paymentStatus?: string; paymentMethod?: string | null;
  providerCheckoutUrl?: string | null; source?: 'SOFIA';
  availablePaymentMethods?: Array<{ method: PaymentMethodCode; label: string; description: string; enabled: boolean; phone?: string | null; holderName?: string | null; instructionsText?: string | null }>;
  expiresAt?: string | null; message?: string;
};

const methodIcons: Record<PaymentMethodCode, React.ReactNode> = {
  ONLINE: <CreditCard className="h-4 w-4" />, NEQUI_MANUAL: <MessageCircle className="h-4 w-4" />, CASH: <ShieldCheck className="h-4 w-4" />,
};

function paymentMessage(order: PublicPaymentOrder, selectedMessage: string | null) {
  if (selectedMessage) return selectedMessage;
  if (order.expired) return 'Link vencido';
  if (order.paymentStatus === 'PAID') return 'Pago recibido';
  if (order.paymentStatus === 'CASH_ON_DELIVERY') return 'Efectivo contra entrega';
  if (order.paymentStatus === 'PENDING_MANUAL_VERIFICATION') return 'Verificando transferencia';
  return 'Elige como pagar';
}

export default function PublicPaymentPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [order, setOrder] = useState<PublicPaymentOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodCode | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOrder() {
      setIsLoading(true); setError(null);
      try {
        const response = await fetch(`${resolveApiUrl()}/public/sofia/payments/${token}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? 'No encontramos este pedido.');
        if (!cancelled) { setOrder(payload as PublicPaymentOrder); setSelectedMethod((payload as PublicPaymentOrder).paymentMethod as PaymentMethodCode | null); setCheckoutUrl((payload as PublicPaymentOrder).providerCheckoutUrl ?? null); }
      } catch (loadError) { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'No encontramos este pedido.'); }
      finally { if (!cancelled) setIsLoading(false); }
    }
    void loadOrder();
    return () => { cancelled = true; };
  }, [token]);

  const visibleMethods = useMemo(() => order?.availablePaymentMethods ?? [], [order?.availablePaymentMethods]);
  const selectedMethodConfig = useMemo(() => visibleMethods.find((m) => m.method === selectedMethod) ?? null, [selectedMethod, visibleMethods]);

  function selectMethod(method: PaymentMethodCode) { const mc = visibleMethods.find((e) => e.method === method); if (!mc?.enabled) return; setSelectedMethod(method); setSelectedMessage(null); }

  async function confirmSelectedMethod() {
    if (!selectedMethod) return; setIsSubmitting(true); setSelectedMessage(null);
    try {
      const response = await fetch(`${resolveApiUrl()}/public/sofia/payments/${token}/select-method`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: selectedMethod }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? 'No pudimos registrar el metodo.');
      setSelectedMessage(payload?.message ?? 'Metodo registrado.');
      setCheckoutUrl(typeof payload?.checkoutUrl === 'string' ? payload.checkoutUrl : null);
      setOrder((c) => c ? { ...c, paymentMethod: payload?.paymentMethod ?? selectedMethod, paymentStatus: payload?.paymentStatus ?? c.paymentStatus, providerCheckoutUrl: payload?.checkoutUrl ?? c.providerCheckoutUrl } : c);
    } catch (selectError) { setSelectedMessage(selectError instanceof Error ? selectError.message : 'No pudimos registrar el metodo.'); }
    finally { setIsSubmitting(false); }
  }

  return (
    <main className="flex min-h-screen flex-col bg-black px-5 py-8 sm:px-8" data-testid="public-payment-page">
      <div className="mx-auto w-full max-w-md flex-1">

        {/* Logo — prominent, centered */}
        <div className="mb-10 flex justify-center">
          <Image src="/brand/sidebar-logo.png" alt="2X1 Burger Co." width={220} height={80} priority className="h-auto w-44 object-contain" />
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-3" data-testid="public-payment-loading">
            {Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />))}
          </div>
        ) : null}

        {/* Error */}
        {!isLoading && error ? (
          <div className="text-center py-12" data-testid="public-payment-invalid">
            <TriangleAlert className="mx-auto h-8 w-8 text-red-400" />
            <p className="mt-6 text-[17px] font-extrabold text-white">No encontrado</p>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">{error}</p>
          </div>
        ) : null}

        {/* Expired */}
        {!isLoading && order?.expired ? (
          <div className="text-center py-12" data-testid="public-payment-expired">
            <Clock3 className="mx-auto h-8 w-8 text-amber-400" />
            <p className="mt-6 text-[17px] font-extrabold text-white">Link vencido</p>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">{order.message}</p>
          </div>
        ) : null}

        {/* Order content */}
        {!isLoading && order && !order.expired ? (
          <div className="space-y-8">
            {/* Sofia chip */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-300">
                <Sparkles className="h-3 w-3" />Sofia
              </span>
              <span className="text-[12px] font-medium text-stone-500" data-testid="public-payment-status">{paymentMessage(order, selectedMessage)}</span>
            </div>

            {/* Total — dominant, Apple-like */}
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-stone-500">Total a pagar</p>
              <p className="mt-3 text-[3.2rem] font-black leading-none tracking-tight text-white tabular-nums" data-testid="public-payment-total">
                {formatCurrency(order.total ?? 0)}
              </p>
              <p className="mt-3 text-[13px] text-stone-500" data-testid="public-payment-reference">{order.orderReference}</p>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.06]" />

            {/* Items — flat list, no boxes */}
            <div data-testid="public-payment-order-summary">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-stone-500 mb-4">Tu pedido</p>
              <div className="space-y-3">
                {(order.items ?? []).map((item) => (
                  <div key={`${item.code}-${item.name}`} className="flex items-start justify-between gap-4">
                    <p className="text-[14px] font-semibold text-white">{item.quantity} x {item.name}</p>
                    <p className="shrink-0 text-[14px] font-semibold text-stone-400 tabular-nums">{formatCurrency(item.totalPrice)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2 pt-4 border-t border-white/[0.06]">
                <div className="flex justify-between text-[13px]"><span className="text-stone-500">Subtotal</span><span className="text-stone-400 tabular-nums">{formatCurrency(order.subtotal ?? 0)}</span></div>
                <div className="flex justify-between text-[13px]"><span className="text-stone-500">Domicilio</span><span className="text-stone-400 tabular-nums">{formatCurrency(order.deliveryFee ?? 0)}</span></div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.06]" />

            {/* Customer — flat */}
            <div data-testid="public-payment-customer">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-stone-500 mb-4">Entrega</p>
              <p className="text-[14px] font-semibold text-white">{order.customerName ?? '—'}</p>
              <p className="mt-1 text-[13px] text-stone-400">{order.customerPhone ?? '—'}</p>
              <p className="mt-0.5 text-[13px] text-stone-500">{order.deliveryAddress ?? '—'}</p>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.06]" />

            {/* Payment methods — subtle selection */}
            <div data-testid="public-payment-methods">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-stone-500 mb-4">Metodo de pago</p>
              <div className="space-y-1.5">
                {visibleMethods.map((method) => (
                  <button key={method.method} type="button" onClick={() => selectMethod(method.method)} disabled={isSubmitting || !method.enabled}
                    className={`w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left transition ${
                      selectedMethod === method.method ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    } ${!method.enabled ? 'opacity-30' : ''}`}
                    data-testid={`public-payment-method-${method.method.toLowerCase()}`}>
                    <div className="flex items-center gap-3.5">
                      <span className="text-stone-400">{methodIcons[method.method]}</span>
                      <div>
                        <p className="text-[14px] font-semibold text-white">{method.label}</p>
                        <p className="mt-0.5 text-[11px] text-stone-500">{method.description}</p>
                      </div>
                    </div>
                    {selectedMethod === method.method ? <CheckCircle2 className="h-4 w-4 text-brand-400 shrink-0" /> : <div className="h-4 w-4 rounded-full border border-white/10" />}
                  </button>
                ))}
              </div>
            </div>

            {/* CASH */}
            {selectedMethodConfig?.method === 'CASH' ? (
              <div className="text-center space-y-4" data-testid="public-cash-instructions">
                <div className="h-px bg-white/[0.06]" />
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-400">Efectivo contra entrega</p>
                <p className="text-[1.8rem] font-black text-white tabular-nums">{formatCurrency(order.total ?? 0)}</p>
                <p className="text-[13px] text-stone-500">Pago al recibir tu pedido. Ten listo: {formatCurrency(order.total ?? 0)}.</p>
                <Button className="w-full rounded-xl bg-white py-5 text-[14px] font-extrabold text-black hover:bg-stone-200" onClick={confirmSelectedMethod} disabled={isSubmitting} data-testid="public-confirm-cash">Confirmar efectivo</Button>
              </div>
            ) : null}

            {/* NEQUI */}
            {selectedMethodConfig?.method === 'NEQUI_MANUAL' ? (
              <div className="space-y-4" data-testid="public-nequi-instructions">
                <div className="h-px bg-white/[0.06]" />
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-400">Transferencia Nequi</p>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-[13px]"><span className="text-stone-500">Numero</span><span className="font-semibold text-white" data-testid="public-nequi-phone">{selectedMethodConfig.phone}</span></div>
                  {selectedMethodConfig.holderName ? <div className="flex justify-between text-[13px]"><span className="text-stone-500">Titular</span><span className="font-semibold text-white">{selectedMethodConfig.holderName}</span></div> : null}
                  <div className="flex justify-between text-[13px]"><span className="text-stone-500">Valor</span><span className="font-semibold text-white tabular-nums">{formatCurrency(order.total ?? 0)}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-stone-500">Referencia</span><span className="font-semibold text-white" data-testid="public-nequi-reference">{order.orderReference}</span></div>
                </div>
                <p className="text-[12px] text-stone-500 leading-relaxed">Transfiere el valor exacto y envia el comprobante por WhatsApp.</p>
                <Button className="w-full rounded-xl bg-violet-600 py-5 text-[14px] font-extrabold text-white hover:bg-violet-700" onClick={confirmSelectedMethod} disabled={isSubmitting} data-testid="public-confirm-nequi">Ya transferi</Button>
              </div>
            ) : null}

            {/* ONLINE */}
            {selectedMethodConfig?.method === 'ONLINE' ? (
              <div className="text-center space-y-4" data-testid="public-online-instructions">
                <div className="h-px bg-white/[0.06]" />
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-400">Pago en linea</p>
                <p className="text-[1.8rem] font-black text-white tabular-nums">{formatCurrency(order.total ?? 0)}</p>
                <p className="text-[13px] text-stone-500">Pago seguro con proveedor externo.</p>
                <Button className="w-full rounded-xl bg-brand-500 py-5 text-[14px] font-extrabold text-black hover:bg-brand-400" onClick={confirmSelectedMethod} disabled={isSubmitting} data-testid="public-confirm-online">Pagar ahora</Button>
              </div>
            ) : null}

            {/* WhatsApp + Checkout */}
            <div className="space-y-2 pt-2">
              <a href={order.customerPhone ? `https://wa.me/${order.customerPhone.replace(/[^\d]/g, '')}` : '#'}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-4 text-[13px] font-semibold text-stone-500 hover:text-stone-300 transition"
                data-testid="public-payment-whatsapp-link">
                <MessageCircle className="h-4 w-4" />WhatsApp
              </a>
              {checkoutUrl ? (
                <a href={checkoutUrl} target="_blank" rel="noreferrer"
                  className="flex w-full items-center justify-center rounded-xl bg-white py-4 text-[14px] font-extrabold text-black hover:bg-stone-200 transition"
                  data-testid="public-online-checkout-link">Continuar al pago</a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
