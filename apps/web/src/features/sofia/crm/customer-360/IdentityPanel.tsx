import { Phone, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { formatDateTime } from '@/lib/format';

export function IdentityPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <div className="space-y-3" data-testid="sofia-customer360-identity-panel">
      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Datos generales</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-600">Nombre</dt>
            <dd className="mt-0.5 text-[13px] font-bold text-ink">{customerDisplayName(customer.displayName)}</dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-600">Estado</dt>
            <dd className="mt-1">
              <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'read_only'} label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'} />
            </dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-600">Registrado</dt>
            <dd className="mt-0.5 text-[13px] font-bold text-ink">{formatDateTime(customer.createdAt)}</dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-600">Última actualización</dt>
            <dd className="mt-0.5 text-[13px] font-bold text-ink">{formatDateTime(customer.updatedAt)}</dd>
          </div>
        </dl>
      </Card>

      <Card data-testid="sofia-customer360-identities">
        <h3 className="text-[13.5px] font-extrabold text-ink">Identidades enmascaradas</h3>
        {customer.identities.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<Phone className="h-5 w-5" />} title="Sin identidades" description="Este cliente no tiene identidades registradas todavía." />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.identities.map((identity) => (
              <li key={identity.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-stone-600 shadow-sm">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-ink">{identity.valueMasked}</p>
                    <p className="text-[11px] text-stone-600">
                      {identity.type} {identity.isPrimary ? '· Principal' : ''}
                    </p>
                  </div>
                </div>
                {identity.verifiedAt ? (
                  <StatusBadge tone="success" label="Verificada" data-testid="sofia-customer360-identity-verified" />
                ) : (
                  <StatusBadge tone="pending" label="Sin verificar" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="border-stone-200 bg-stone-50/60">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
          <p className="text-[12px] leading-5 text-stone-600">
            Las identidades se muestran siempre enmascaradas. SOFIA nunca expone números completos ni evidencia cruda desde este panel.
          </p>
        </div>
      </Card>
    </div>
  );
}
