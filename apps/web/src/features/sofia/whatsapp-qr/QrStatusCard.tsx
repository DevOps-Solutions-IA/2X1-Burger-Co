import Image from 'next/image';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SectionHeading, StatCard, StatusBadge } from '@/components/sofia';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SofiaQrStatus } from '@/features/sofia/contracts';

const STATUS_LABEL: Record<SofiaQrStatus['status'], string> = {
  DISABLED: 'Deshabilitado',
  DISCONNECTED: 'Desconectado',
  CONNECTING: 'Conectando',
  WAITING_QR: 'Esperando QR',
  QR_READY: 'QR listo para escanear',
  CONNECTED: 'Conectado',
  RECONNECTING: 'Reconectando',
  FAILED: 'Falló',
  LOGGED_OUT: 'Sesión cerrada',
};

function statusTone(status: SofiaQrStatus['status']) {
  if (status === 'CONNECTED') return 'success' as const;
  if (status === 'QR_READY' || status === 'CONNECTING' || status === 'RECONNECTING' || status === 'WAITING_QR') return 'pending' as const;
  if (status === 'FAILED') return 'failed' as const;
  return 'blocked' as const;
}

function StatusHeroIcon({ status }: { status: SofiaQrStatus['status'] }) {
  const baseClass = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border';
  if (status === 'CONNECTED') {
    return (
      <span className={cn(baseClass, 'border-emerald-200 bg-emerald-50 text-emerald-700')} aria-hidden="true">
        <Wifi className="h-6 w-6" />
      </span>
    );
  }
  if (status === 'QR_READY') {
    return (
      <span className={cn(baseClass, 'border-sky-200 bg-sky-50 text-sky-700')} aria-hidden="true">
        <QrCode className="h-6 w-6" />
      </span>
    );
  }
  if (status === 'CONNECTING' || status === 'RECONNECTING' || status === 'WAITING_QR') {
    return (
      <span className={cn(baseClass, 'border-amber-200 bg-amber-50 text-amber-700')} aria-hidden="true">
        <RefreshCw className="h-6 w-6 motion-safe:animate-spin" />
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className={cn(baseClass, 'border-red-200 bg-red-50 text-red-700')} aria-hidden="true">
        <XCircle className="h-6 w-6" />
      </span>
    );
  }
  return (
    <span className={cn(baseClass, 'border-stone-200 bg-stone-100 text-stone-500')} aria-hidden="true">
      <WifiOff className="h-6 w-6" />
    </span>
  );
}

export function QrStatusCard({ status }: { status: SofiaQrStatus }) {
  return (
    <div className="space-y-4" data-testid="sofia-whatsapp-qr-status-card">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <StatusHeroIcon status={status.status} />
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-500">Estado de conexión</p>
              <h2 className="mt-0.5 text-[19px] font-bold leading-tight text-ink">{STATUS_LABEL[status.status]}</h2>
              {status.deviceName && (
                <p className="mt-1 flex items-center gap-1 text-[12.5px] text-stone-600">
                  <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> {status.deviceName}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusBadge tone={statusTone(status.status)} label={STATUS_LABEL[status.status]} />
            <StatusBadge tone={status.adapterReal ? 'success' : 'warning'} label={status.adapterReal ? 'Adapter real' : 'Adapter simulado'} />
            <StatusBadge tone="read_only" label="Receive-only" />
            <StatusBadge tone="blocked" label="Envío real OFF" />
          </div>
        </div>

        {status.qrAvailable && status.qrImageDataUrl ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-[1.25rem] border border-dashed border-sky-200 bg-sky-50/40 p-5">
            <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-soft">
              <Image src={status.qrImageDataUrl} alt="Código QR de vinculación de WhatsApp" width={220} height={220} unoptimized className="rounded-lg" />
            </div>
            <p className="text-center text-[12px] font-medium text-stone-600">Escanea con WhatsApp para vincular el canal.</p>
          </div>
        ) : null}

        {status.operatorMessage ? (
          <p className="mt-4 rounded-[0.9rem] bg-stone-50 px-3.5 py-2.5 text-[12px] font-medium leading-5 text-stone-600">{status.operatorMessage}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-2 text-[11.5px] text-stone-600 sm:grid-cols-2">
          <p>
            Última conexión: <span className="font-semibold text-ink">{formatDateTime(status.lastConnectedAt)}</span>
          </p>
          <p>
            Actualizado: <span className="font-semibold text-ink">{formatDateTime(status.updatedAt)}</span>
          </p>
        </div>

        {status.lastError ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <p className="text-[12px] font-semibold text-red-800">{status.lastError}</p>
          </div>
        ) : null}
      </Card>

      <Card data-testid="sofia-whatsapp-qr-metrics">
        <SectionHeading icon={<ArrowDownToLine className="h-4.5 w-4.5" />} title="Actividad del día" tone="ink" />
        <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <StatCard
            label="Recibidos hoy"
            value={String(status.inboundToday)}
            hint="Mensajes entrantes"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            data-testid="sofia-whatsapp-qr-metric-inbound"
          />
          <StatCard
            label="Enviados hoy"
            value={String(status.outboundToday)}
            hint="Solo sugerencias/borradores"
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            data-testid="sofia-whatsapp-qr-metric-outbound"
          />
          <StatCard
            label="Pendientes de salida"
            value={String(status.pendingOutbound)}
            hint="En cola, envío real bloqueado"
            accent="warning"
            icon={<Clock3 className="h-4 w-4" />}
            data-testid="sofia-whatsapp-qr-metric-pending"
          />
        </div>
      </Card>

      {(status.blockers.length > 0 || status.warnings.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {status.blockers.length > 0 && (
            <Card className="border-red-200 bg-red-50/60" data-testid="sofia-whatsapp-qr-blockers">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-red-700">
                <ShieldAlert className="h-3.5 w-3.5" /> Bloqueadores
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-red-800">
                {status.blockers.map((blocker) => (
                  <li key={blocker}>• {blocker}</li>
                ))}
              </ul>
            </Card>
          )}
          {status.warnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/60" data-testid="sofia-whatsapp-qr-warnings">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> Precauciones
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-amber-800">
                {status.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
