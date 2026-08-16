'use client';

import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/sofia';
import { ApiError } from '@/lib/api';
import { useSofiaCrmGrantOptIn, useSofiaCrmRevokeOptIn } from '@/features/sofia/queries';
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
  const [action, setAction] = useState<'GRANT' | 'REVOKE'>('GRANT');
  const [purpose, setPurpose] = useState<'MARKETING' | 'SERVICE'>('MARKETING');
  const [channel, setChannel] = useState<'WHATSAPP' | 'SMS' | 'PHONE'>('WHATSAPP');
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState('');

  const grantOptIn = useSofiaCrmGrantOptIn();
  const revokeOptIn = useSofiaCrmRevokeOptIn();
  const activeMutation = action === 'GRANT' ? grantOptIn : revokeOptIn;

  const canSubmit = source.trim().length > 0 && evidence.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const input = { customerId: customer.id, purpose, channel, source: source.trim(), evidence: evidence.trim() };
    activeMutation.mutate(input, {
      onSuccess: () => {
        toast.success(action === 'GRANT' ? 'Consentimiento otorgado' : 'Consentimiento revocado');
        setSource('');
        setEvidence('');
      },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'No se pudo registrar el consentimiento.'),
    });
  }

  return (
    <div className="space-y-3" data-testid="sofia-customer360-consents-panel">
      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Consentimientos de contacto</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Consentimiento por propósito y canal, con evidencia auditable.</p>

        {customer.consents.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />} title="Sin consentimientos" description="No hay consentimientos registrados para este cliente." />
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

      <Card data-testid="sofia-customer360-consents-form">
        <h3 className="text-[13.5px] font-extrabold text-ink">Registrar consentimiento</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Otorga o revoca un consentimiento de contacto con evidencia auditable.</p>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Acción</label>
              <Select value={action} onChange={(event) => setAction(event.target.value as 'GRANT' | 'REVOKE')} data-testid="sofia-customer360-consents-action">
                <option value="GRANT">Otorgar</option>
                <option value="REVOKE">Revocar</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Propósito</label>
              <Select value={purpose} onChange={(event) => setPurpose(event.target.value as 'MARKETING' | 'SERVICE')} data-testid="sofia-customer360-consents-purpose">
                <option value="MARKETING">Mercadeo</option>
                <option value="SERVICE">Servicio</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Canal</label>
            <Select value={channel} onChange={(event) => setChannel(event.target.value as 'WHATSAPP' | 'SMS' | 'PHONE')} data-testid="sofia-customer360-consents-channel">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="PHONE">Llamada</option>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Fuente</label>
            <Input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Ej: llamada-servicio-cliente, formulario-web…"
              data-testid="sofia-customer360-consents-source"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Evidencia</label>
            <Input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Referencia de la evidencia del consentimiento…"
              data-testid="sofia-customer360-consents-evidence"
            />
          </div>

          {activeMutation.isError && (
            <p className="text-[12px] font-semibold text-red-700" role="alert">
              {activeMutation.error instanceof ApiError ? activeMutation.error.message : 'No se pudo registrar el consentimiento.'}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canSubmit || activeMutation.isPending} data-testid="sofia-customer360-consents-submit">
              {activeMutation.isPending ? 'Guardando…' : action === 'GRANT' ? 'Otorgar consentimiento' : 'Revocar consentimiento'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
