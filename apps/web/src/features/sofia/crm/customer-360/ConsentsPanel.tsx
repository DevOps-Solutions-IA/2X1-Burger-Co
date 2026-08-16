import { ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { formatDate } from '@/lib/format';

const PURPOSE_LABEL: Record<'MARKETING' | 'SERVICE', string> = {
  MARKETING: 'Mercadeo',
  SERVICE: 'Servicio',
};

const CHANNEL_LABEL: Record<'WHATSAPP' | 'SMS' | 'PHONE', string> = {
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  PHONE: 'Llamada',
};

function truncateEvidence(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export function ConsentsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card data-testid="sofia-customer360-consents-panel">
      <h3 className="text-[13.5px] font-extrabold text-ink">Consentimientos de contacto</h3>
      <p className="mt-0.5 text-[12px] text-stone-600">Consentimiento por propósito y canal, con evidencia auditable.</p>

      {customer.consents.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Sin consentimientos" description="No hay consentimientos registrados para este cliente." />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {customer.consents.map((consent) => (
            <li key={consent.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-ink">
                  {PURPOSE_LABEL[consent.purpose]} &middot; {CHANNEL_LABEL[consent.channel]}
                </p>
                <StatusBadge tone={consent.status === 'GRANTED' ? 'success' : 'blocked'} label={consent.status === 'GRANTED' ? 'Otorgado' : 'Revocado'} />
              </div>
              <p className="mt-1 text-[11px] text-stone-600">
                Fuente: {consent.source} &middot; v{consent.version} &middot; Evidencia: <span title={consent.evidenceHash}>{truncateEvidence(consent.evidenceHash)}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-stone-600">
                {consent.grantedAt ? `Otorgado ${formatDate(consent.grantedAt)}` : 'Sin fecha de otorgamiento'}
                {consent.revokedAt ? ` · Revocado ${formatDate(consent.revokedAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
