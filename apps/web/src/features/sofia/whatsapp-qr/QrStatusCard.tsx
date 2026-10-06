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
import { CONSOLE_ACCENT_ICON_CLASS, CONSOLE_CARD_CLASS, SectionHeading, StatCard, StatusBadge } from '@/components/sofia';
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
      <span className={cn(baseClass, CONSOLE_ACCENT_ICON_CLASS.success)} aria-hidden="true">
        <Wifi className="h-6 w-6" />
      </span>
    );
  }
  if (status === 'QR_READY') {
    return (
      <span className={cn(baseClass, CONSOLE_ACCENT_ICON_CLASS.brand)} aria-hidden="true">
        <QrCode className="h-6 w-6" />
      </span>
    );
  }
  if (status === 'CONNECTING' || status === 'RECONNECTING' || status === 'WAITING_QR') {
    return (
      <span className={cn(baseClass, CONSOLE_ACCENT_ICON_CLASS.warning)} aria-hidden="true">
        <RefreshCw className="h-6 w-6 motion-safe:animate-spin" />
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className={cn(baseClass, CONSOLE_ACCENT_ICON_CLASS.danger)} aria-hidden="true">
        <XCircle className="h-6 w-6" />
      </span>
    );
  }
  return (
    <span className={cn(baseClass, 'border-white/10 bg-white/[0.06] text-white/45')} aria-hidden="true">
      <WifiOff className="h-6 w-6" />
    </span>
  );
}

export function QrStatusCard({ status }: { status: SofiaQrStatus }) {
  return (
    <div className="space-y-4" data-testid="sofia-whatsapp-qr-status-card">
      <div className={cn(CONSOLE_CARD_CLASS)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <StatusHeroIcon status={status.status} />
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/55">Estado de conexión</p>
              <h2 className="mt-0.5 text-[19px] font-bold leading-tight text-white">{STATUS_LABEL[status.status]}</h2>
              {status.deviceName && (
                <p className="mt-1 flex items-center gap-1 text-[12.5px] text-white/70">
                  <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> {status.deviceName}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusBadge tone={statusTone(status.status)} label={STATUS_LABEL[status.status]} variant="console" />
            <StatusBadge
              tone={status.adapterReal ? 'success' : 'warning'}
              label={status.adapterReal ? 'Adapter real' : 'Adapter simulado'}
              variant="console"
            />
            <StatusBadge tone="read_only" label="Receive-only" variant="console" />
            <StatusBadge tone="blocked" label="Envío real OFF" variant="console" />
          </div>
        </div>

        {status.qrAvailable && status.qrImageDataUrl ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-[1.25rem] border border-dashed border-brand-400/25 bg-brand-400/[0.06] p-5">
            <div className="rounded-2xl border border-white/10 bg-white p-3 shadow-soft">
              <Image src={status.qrImageDataUrl} alt="Código QR de vinculación de WhatsApp" width={220} height={220} unoptimized className="rounded-lg" />
            </div>
            <p className="text-center text-[12px] font-medium text-white/70">Escanea con WhatsApp para vincular el canal.</p>
          </div>
        ) : null}

        {status.operatorMessage ? (
          <p className="mt-4 rounded-[0.9rem] bg-white/[0.06] px-3.5 py-2.5 text-[12px] font-medium leading-5 text-white/70">{status.operatorMessage}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-2 text-[11.5px] text-white/70 sm:grid-cols-2">
          <p>
            Última conexión: <span className="font-semibold text-white">{formatDateTime(status.lastConnectedAt)}</span>
          </p>
          <p>
            Actualizado: <span className="font-semibold text-white">{formatDateTime(status.updatedAt)}</span>
          </p>
        </div>

        {status.lastError ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3.5 py-2.5" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
            <p className="text-[12px] font-semibold text-red-200">{status.lastError}</p>
          </div>
        ) : null}
      </div>

      <div className={cn(CONSOLE_CARD_CLASS)} data-testid="sofia-whatsapp-qr-metrics">
        <SectionHeading icon={<ArrowDownToLine className="h-4.5 w-4.5" />} title="Actividad del día" tone="ink" variant="console" />
        <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <StatCard
            label="Recibidos hoy"
            value={String(status.inboundToday)}
            hint="Mensajes entrantes"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            variant="console"
            data-testid="sofia-whatsapp-qr-metric-inbound"
          />
          <StatCard
            label="Enviados hoy"
            value={String(status.outboundToday)}
            hint="Solo sugerencias/borradores"
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            variant="console"
            data-testid="sofia-whatsapp-qr-metric-outbound"
          />
          <StatCard
            label="Pendientes de salida"
            value={String(status.pendingOutbound)}
            hint="En cola, envío real bloqueado"
            accent="warning"
            icon={<Clock3 className="h-4 w-4" />}
            variant="console"
            data-testid="sofia-whatsapp-qr-metric-pending"
          />
        </div>
      </div>

      {(status.blockers.length > 0 || status.warnings.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {status.blockers.length > 0 && (
            <div className={cn(CONSOLE_CARD_CLASS, 'border-red-400/25 bg-red-400/[0.08]')} data-testid="sofia-whatsapp-qr-blockers">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-red-200">
                <ShieldAlert className="h-3.5 w-3.5" /> Bloqueadores
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-red-200">
                {status.blockers.map((blocker) => (
                  <li key={blocker}>• {blocker}</li>
                ))}
              </ul>
            </div>
          )}
          {status.warnings.length > 0 && (
            <div className={cn(CONSOLE_CARD_CLASS, 'border-amber-400/25 bg-amber-400/[0.08]')} data-testid="sofia-whatsapp-qr-warnings">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" /> Precauciones
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-amber-200">
                {status.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
