'use client';

import Image from 'next/image';
import { useId } from 'react';
import { LoaderCircle, QrCode, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusBanner } from '@/components/ui/status-banner';
import { formatCurrency } from '@/lib/format';
import { formatReceiptNumber } from '@/lib/receipt-number';
import type { ThermalReceiptData } from '@/lib/thermal-receipt';
import type { WhatsappSessionStatus } from './pos.types';
import { useAccessibleModal } from '@/components/use-accessible-modal';

type WhatsappSessionMeta = {
  tone: 'danger' | 'success' | 'warning' | 'info';
  label: string;
  description: string;
};

export function PosWhatsappReceiptModal({
  lastReceipt,
  receiptWhatsappPhone,
  whatsappSession,
  whatsappSessionMeta,
  refreshPending,
  disconnectPending,
  sendPending,
  onReceiptWhatsappPhoneChange,
  onRefreshWhatsappSession,
  onDisconnectWhatsappSession,
  onSendReceipt,
  onClose,
}: {
  lastReceipt: ThermalReceiptData;
  receiptWhatsappPhone: string;
  whatsappSession: WhatsappSessionStatus | undefined;
  whatsappSessionMeta: WhatsappSessionMeta;
  refreshPending: boolean;
  disconnectPending: boolean;
  sendPending: boolean;
  onReceiptWhatsappPhoneChange: (phone: string) => void;
  onRefreshWhatsappSession: () => void;
  onDisconnectWhatsappSession: () => void;
  onSendReceipt: (payload: { saleId: string; phone: string; closeModal: boolean }) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const { panelRef, handleKeyDown } = useAccessibleModal<HTMLDivElement>(true, onClose);

  return (
    <div
      data-modal-root
      className="fixed inset-0 z-50 bg-stone-950/38 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          ref={panelRef}
          className="hide-scrollbar flex max-h-[88vh] w-full max-w-xl flex-col overflow-y-auto rounded-t-[1.65rem] border border-stone-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] sm:rounded-[1.7rem]"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <div className="sticky top-0 z-10 border-b border-stone-100 bg-white/96 px-4 py-3.5 backdrop-blur sm:px-5">
            <div className="mb-2 flex justify-center sm:hidden">
              <span className="h-1.5 w-14 rounded-full bg-stone-200" />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">Enviar comprobante</p>
                <h2 id={titleId} className="mt-1 text-[1rem] font-semibold text-ink">WhatsApp interno · {formatReceiptNumber(lastReceipt.saleNumber)}</h2>
                <p className="mt-1 text-[12px] text-stone-500">
                  El sistema envía el PDF desde la sesión vinculada del WhatsApp del negocio.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar envío por WhatsApp"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-ink"
                onClick={onClose}
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <StatusBanner
              tone={whatsappSessionMeta.tone}
              title={whatsappSessionMeta.label}
              description={whatsappSessionMeta.description}
            />

            {whatsappSession?.qrDataUrl ? (
              <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Escanea este QR con el WhatsApp del negocio</p>
                    <p className="mt-1 text-[13px] leading-6 text-stone-500">
                      Hazlo una sola vez. Cuando quede conectado, el envío seguirá ocurriendo desde este sistema.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-center rounded-[1.25rem] border border-stone-200 bg-white p-4">
                  <Image
                    src={whatsappSession.qrDataUrl}
                    alt="QR de conexión de WhatsApp"
                    width={256}
                    height={256}
                    className="h-64 w-64 max-w-full rounded-[1rem] object-contain"
                    unoptimized
                  />
                </div>
              </div>
            ) : null}

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Cliente destino</p>
                  <p className="mt-1 text-[13px] leading-6 text-stone-500">
                    Escribe el número del cliente y el sistema enviará el comprobante PDF desde la cuenta vinculada.
                  </p>
                </div>
                <Badge tone="success">{formatCurrency(lastReceipt.total)}</Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Field label="Número del cliente" required hint="Ejemplo: 3001234567 o +57 3001234567">
                  <Input
                    value={receiptWhatsappPhone}
                    onChange={(event) => onReceiptWhatsappPhoneChange(event.target.value)}
                    placeholder="3001234567"
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={onRefreshWhatsappSession}
                    disabled={refreshPending}
                  >
                    {refreshPending ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Actualizando
                      </>
                    ) : (
                      'Actualizar QR'
                    )}
                  </Button>
                </div>
              </div>

              <div className="mt-4 rounded-[1.15rem] border border-stone-200 bg-stone-50 px-3.5 py-3 text-[13px] text-stone-600">
                <div className="flex items-center justify-between gap-3">
                  <span>Comprobante</span>
                  <strong className="text-ink">{formatReceiptNumber(lastReceipt.saleNumber)}</strong>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span>Total</span>
                  <strong className="text-ink">{formatCurrency(lastReceipt.total)}</strong>
                </div>
              </div>
            </Card>
          </div>

          <div className="sticky bottom-0 z-10 border-t border-stone-200 bg-white/97 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="sm:w-auto"
                onClick={onDisconnectWhatsappSession}
                disabled={disconnectPending}
              >
                {disconnectPending ? 'Desvinculando...' : 'Desvincular'}
              </Button>
              <Button type="button" variant="secondary" className="sm:w-auto" onClick={onClose}>
                Cerrar
              </Button>
              <Button
                type="button"
                className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
                disabled={
                  !receiptWhatsappPhone.trim() ||
                  whatsappSession?.connectionState !== 'CONNECTED' ||
                  sendPending
                }
                onClick={() =>
                  onSendReceipt({
                    saleId: lastReceipt.saleId,
                    phone: receiptWhatsappPhone,
                    closeModal: true,
                  })
                }
              >
                {sendPending ? 'Enviando comprobante...' : 'Enviar comprobante'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
