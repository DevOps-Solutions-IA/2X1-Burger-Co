import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';

const PURPOSE_LABEL: Record<string, string> = { MARKETING: 'Marketing', SERVICE: 'Servicio' };
const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', SMS: 'SMS', PHONE: 'Llamada' };

export function ConsentsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card data-testid="sofia-customer360-consents">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">Consentimientos</p>
      <h2 className="text-[15px] font-semibold text-ink">Consentimientos de contacto</h2>

      {customer.consents.length > 0 ? (
        <div className="mt-3 space-y-2">
          {customer.consents.map((consent) => (
            <div key={consent.id} className="rounded-[0.9rem] bg-stone-50 px-3 py-2.5" data-testid={`sofia-consent-${consent.id}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-ink">
                  {PURPOSE_LABEL[consent.purpose] ?? consent.purpose} · {CHANNEL_LABEL[consent.channel] ?? consent.channel}
                </p>
                <StatusBadge tone={consent.status === 'GRANTED' ? 'success' : 'blocked'} label={consent.status === 'GRANTED' ? 'Otorgado' : 'Revocado'} withDot={false} />
              </div>
              <p className="mt-1 text-[10.5px] font-medium text-stone-500">
                Fuente: {consent.source} · Versión {consent.version} ·{' '}
                {consent.grantedAt ? `Otorgado ${new Date(consent.grantedAt).toLocaleDateString('es-CO')}` : ''}
                {consent.revokedAt ? ` · Revocado ${new Date(consent.revokedAt).toLocaleDateString('es-CO')}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState title="Sin consentimientos" description="Este cliente no tiene consentimientos registrados." />
        </div>
      )}
    </Card>
  );
}
