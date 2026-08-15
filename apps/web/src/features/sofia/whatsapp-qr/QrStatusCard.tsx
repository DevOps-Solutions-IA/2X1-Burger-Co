import { QrCode } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaQrStatus } from '@/features/sofia/contracts';

export function QrStatusCard({ status }: { status: SofiaQrStatus }) {
  return (
    <Card className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]" data-testid="sofia-qr-status-card">
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Estado</p>
        <div className="mt-1.5 flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-ink">{status.status}</h2>
          <StatusBadge tone={status.connected ? 'success' : status.qrAvailable ? 'pending' : 'read_only'} label={status.connected ? 'Conectado' : status.qrAvailable ? 'QR listo' : 'Sin conexión'} />
        </div>

        <div className="mt-3.5 space-y-1.5">
          <Row label="Adapter real" value={status.adapterReal ? 'Sí' : 'No'} tone={status.adapterReal ? 'success' : 'warning'} />
          <Row label="Envío real" value="Bloqueado" tone="blocked" />
          <Row label="Sesión" value={status.sessionName} />
          <Row label="Inbound hoy" value={String(status.inboundToday)} />
          <Row label="Salientes pendientes" value={String(status.pendingOutbound)} />
          {status.deviceName && <Row label="Dispositivo" value={status.deviceName} />}
          {status.phoneNumber && <Row label="Número" value={status.phoneNumber} />}
        </div>

        {status.blockers.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5" data-testid="sofia-qr-blockers">
            {status.blockers.map((blocker) => (
              <StatusBadge key={blocker} tone="blocked" label={blocker} />
            ))}
          </div>
        )}

        <p className="mt-3.5 rounded-[0.9rem] bg-sofia-50 px-3 py-2.5 text-[12px] font-medium text-sofia-800">{status.operatorMessage}</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-[1.1rem] border border-dashed border-sofia-200 bg-sofia-50/40 p-5">
        {status.qrImageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL generado en runtime; next/image no aporta optimización sobre un data: URI ya renderizado.
          <img src={status.qrImageDataUrl} alt="Código QR de vinculación WhatsApp" className="h-48 w-48 rounded-[0.9rem] bg-white p-2 shadow-sm" data-testid="sofia-qr-image" />
        ) : (
          <>
            <QrCode className="h-10 w-10 text-sofia-300" aria-hidden="true" />
            <p className="mt-2.5 text-[12.5px] font-medium text-stone-500">Sin QR disponible en este momento.</p>
          </>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'blocked' }) {
  return (
    <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-medium text-stone-600">{label}</span>
      {tone ? <StatusBadge tone={tone} label={value} withDot={false} /> : <span className="text-[12px] font-semibold text-ink">{value}</span>}
    </div>
  );
}
