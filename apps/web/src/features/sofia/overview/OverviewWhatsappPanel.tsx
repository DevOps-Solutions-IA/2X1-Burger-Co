import Link from 'next/link';
import { Radio, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaDashboardSummary } from '@/features/sofia/contracts';

export function OverviewWhatsappPanel({ whatsappQr }: { whatsappQr: SofiaDashboardSummary['whatsappQr'] }) {
  return (
    <Card data-testid="sofia-overview-whatsapp-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[0.65rem] bg-brand-100 text-brand-700">
            <Radio className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">WhatsApp</p>
            <h3 className="text-[14px] font-semibold text-ink">Vinculación QR</h3>
          </div>
        </div>
        <StatusBadge tone={whatsappQr.connected ? 'success' : 'pending'} label={whatsappQr.status} />
      </div>

      <div className="mt-3.5 space-y-1.5">
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Adapter real</span>
          <StatusBadge tone={whatsappQr.adapterReal ? 'success' : 'warning'} label={whatsappQr.adapterReal ? 'Sí' : 'No'} withDot={false} />
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Envío real</span>
          <StatusBadge tone="blocked" label="Bloqueado" withDot={false} />
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Inbound hoy</span>
          <span className="text-[12px] font-semibold text-ink">{whatsappQr.inboundToday}</span>
        </div>
        <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
          <span className="text-[12px] font-medium text-stone-600">Fuente</span>
          <span className="text-[12px] font-semibold text-ink">
            {whatsappQr.source === 'real_operation' ? 'Operación real' : 'Validación interna'}
          </span>
        </div>
      </div>

      <Link
        href="/sofia/whatsapp-qr"
        className="mt-3.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
        data-testid="sofia-overview-whatsapp-link"
      >
        Ver vinculación
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Card>
  );
}
