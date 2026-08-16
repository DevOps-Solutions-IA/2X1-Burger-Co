import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { StatusBadge } from '@/components/sofia';
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

export function QrStatusCard({ status }: { status: SofiaQrStatus }) {
  return (
    <div className="space-y-4" data-testid="sofia-whatsapp-qr-status-card">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Estado de conexión</p>
            <h2 className="mt-1 text-[18px] font-bold text-ink">{STATUS_LABEL[status.status]}</h2>
            {status.deviceName && <p className="mt-1 text-[12.5px] text-stone-600">Dispositivo: {status.deviceName}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={statusTone(status.status)} label={STATUS_LABEL[status.status]} />
            <StatusBadge tone={status.adapterReal ? 'success' : 'warning'} label={status.adapterReal ? 'Adapter real' : 'Adapter simulado'} />
            <StatusBadge tone="read_only" label="Receive-only" />
            <StatusBadge tone="blocked" label="Envío real OFF" />
          </div>
        </div>

        {status.qrAvailable && status.qrImageDataUrl && (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[1.15rem] border border-dashed border-stone-200 bg-stone-50/70 p-4">
            <Image src={status.qrImageDataUrl} alt="Código QR de vinculación de WhatsApp" width={220} height={220} unoptimized className="rounded-[0.85rem]" />
            <p className="text-[11.5px] text-stone-600">Escanea con WhatsApp para vincular el canal.</p>
          </div>
        )}

        {(status.blockers.length > 0 || status.warnings.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {status.blockers.length > 0 && (
              <div className="rounded-[1.15rem] border border-red-200 bg-red-50 p-3.5" data-testid="sofia-whatsapp-qr-blockers">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-red-700">Bloqueadores</p>
                <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-red-800">
                  {status.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.warnings.length > 0 && (
              <div className="rounded-[1.15rem] border border-amber-200 bg-amber-50 p-3.5" data-testid="sofia-whatsapp-qr-warnings">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-700">Precauciones</p>
                <ul className="mt-1.5 space-y-1 text-[12px] font-medium text-amber-800">
                  {status.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {status.operatorMessage && (
          <p className="mt-4 rounded-[0.9rem] bg-stone-50 px-3 py-2.5 text-[12px] font-medium text-stone-600">{status.operatorMessage}</p>
        )}
      </Card>

      <section className="grid gap-3 sm:grid-cols-3" data-testid="sofia-whatsapp-qr-metrics">
        <MetricCard label="Recibidos hoy" value={String(status.inboundToday)} hint="Mensajes entrantes" />
        <MetricCard label="Enviados hoy" value={String(status.outboundToday)} hint="Solo sugerencias/borradores" />
        <MetricCard label="Pendientes de salida" value={String(status.pendingOutbound)} hint="En cola, envío real bloqueado" accent="warning" />
      </section>
    </div>
  );
}
