'use client';

import React from 'react';
import { Radio, QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SofiaStatusPill, type SofiaPillStatus } from './SofiaStatusPill';

export type QrGatewaySummary = {
  provider: string;
  mode: string;
  status: string;
  connected: boolean;
  sessionName?: string;
  receiveOnlyReady?: boolean;
  realSendingEnabled: boolean;
  inboundToday?: number;
  outboundToday?: number;
};

export type SofiaQrStatusPanelProps = {
  data: QrGatewaySummary;
  onViewQr?: () => void;
  viewQrHref?: string;
  className?: string;
  'data-testid'?: string;
};

function qrPillStatus(status: string, connected: boolean): SofiaPillStatus {
  if (status === 'CONNECTED' || connected) return 'CONNECTED';
  if (status === 'QR_READY') return 'QR_READY';
  if (status === 'DISCONNECTED') return 'DISCONNECTED';
  return 'NEUTRAL';
}

export function SofiaQrStatusPanel({
  data,
  viewQrHref,
  className,
  'data-testid': testId,
}: SofiaQrStatusPanelProps) {
  return (
    <div
      className={cn(
        'rounded-[1.75rem] border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
          <Radio className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
          WhatsApp QR Gateway
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <h3 className="text-base font-extrabold text-stone-900">Receive-only controlado</h3>
        <SofiaStatusPill
          status={data.receiveOnlyReady ? 'PASS' : 'WARNING'}
          label={data.receiveOnlyReady ? 'PASS' : 'WARNING'}
        />
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between rounded-lg py-1.5">
          <span className="text-xs font-bold text-stone-500">Provider</span>
          <span className="text-xs font-extrabold text-stone-800">{data.provider}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg py-1.5">
          <span className="text-xs font-bold text-stone-500">Modo actual</span>
          <span className="text-xs font-extrabold text-stone-800">{data.mode}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg py-1.5">
          <span className="text-xs font-bold text-stone-500">Estado QR</span>
          <SofiaStatusPill
            status={qrPillStatus(data.status, data.connected)}
            label={data.status}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg py-1.5">
          <span className="text-xs font-bold text-stone-500">Envío real</span>
          <SofiaStatusPill
            status={data.realSendingEnabled ? 'WARNING' : 'BLOCKED'}
            label={data.realSendingEnabled ? 'Activo' : 'Bloqueado'}
          />
        </div>
        {(data.inboundToday !== undefined) && (
          <div className="flex items-center justify-between rounded-lg py-1.5">
            <span className="text-xs font-bold text-stone-500">Inbound hoy</span>
            <span className="text-xs font-extrabold text-stone-800">{data.inboundToday}</span>
          </div>
        )}
      </div>

      <p className="mt-4 rounded-xl bg-purple-50/50 px-4 py-3 text-[11px] font-medium text-stone-500">
        QR Gateway está disponible para receive-only/controlado. Envío real y auto_safe con clientes permanecen bloqueados.
      </p>

      {viewQrHref && (
        <a
          href={viewQrHref}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-stone-800"
          data-testid={`${testId}-cta`}
        >
          <QrCode className="h-3.5 w-3.5" />
          Ver QR / Conectar
        </a>
      )}
    </div>
  );
}
