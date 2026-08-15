import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { customerDisplayName } from '@/features/sofia/crm-display';

export function IdentityPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card className="space-y-3" data-testid="sofia-customer360-identity">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Identidad</p>
          <h2 className="text-[15px] font-semibold text-ink">{customerDisplayName(customer.displayName)}</h2>
        </div>
        <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'read_only'} label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'} />
      </div>

      <div className="space-y-1.5">
        {customer.identities.map((identity) => (
          <div key={identity.id} className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
            <div>
              <p className="text-[12px] font-semibold text-ink">{identity.valueMasked}</p>
              <p className="text-[10.5px] font-medium text-stone-500">{identity.type}{identity.isPrimary ? ' · Primaria' : ''}</p>
            </div>
            <StatusBadge tone={identity.verifiedAt ? 'success' : 'pending'} label={identity.verifiedAt ? 'Verificada' : 'Sin verificar'} withDot={false} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11.5px] font-medium text-stone-500">
        <p>Registrado: {new Date(customer.createdAt).toLocaleDateString('es-CO')}</p>
        <p>Actualizado: {new Date(customer.updatedAt).toLocaleDateString('es-CO')}</p>
      </div>
    </Card>
  );
}
