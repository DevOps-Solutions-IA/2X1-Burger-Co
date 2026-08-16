'use client';

import { ShieldBan } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import { formatDateTime } from '@/lib/format';
import { useSofiaCrmAttemptCampaignSend } from '@/features/sofia/queries';
import type { SofiaCrmCampaign } from '@/features/sofia/contracts';
import { ApiError } from '@/lib/api';

const CAMPAIGN_STATUS_TONE: Record<SofiaCrmCampaign['status'], SofiaStatusTone> = {
  DRAFT: 'pending',
  BLOCKED: 'blocked',
  CANCELLED: 'read_only',
};

const CAMPAIGN_STATUS_LABEL: Record<SofiaCrmCampaign['status'], string> = {
  DRAFT: 'Borrador',
  BLOCKED: 'Bloqueada',
  CANCELLED: 'Cancelada',
};

export function CampaignCard({ campaign }: { campaign: SofiaCrmCampaign }) {
  const attemptSend = useSofiaCrmAttemptCampaignSend();
  const attempted = attemptSend.isSuccess && attemptSend.variables === campaign.id;

  return (
    <Card data-testid={`sofia-crm-campaigns-card-${campaign.id}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-bold text-ink" data-testid="sofia-crm-campaigns-card-name">
              {campaign.name}
            </h3>
            <StatusBadge tone={CAMPAIGN_STATUS_TONE[campaign.status]} label={CAMPAIGN_STATUS_LABEL[campaign.status]} />
            <Badge tone="neutral">{campaign.channel}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-stone-600">
            Segmento: <span className="font-semibold text-stone-700">{campaign.segment?.name ?? 'Sin segmento'}</span>
          </p>
          <p className="mt-2 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2 text-[12.5px] leading-5.5 text-stone-700">
            {campaign.messageTemplate}
          </p>
          <p className="mt-2 text-[11px] text-stone-500">
            {campaign._count.deliveries} entrega(s) registrada(s) · Creada {formatDateTime(campaign.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
          <div
            className="flex max-w-xs items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-800"
            data-testid={`sofia-crm-campaigns-block-notice-${campaign.id}`}
          >
            <ShieldBan className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              El envío real de WhatsApp está bloqueado por diseño en todo el sistema — este botón registra un intento, nunca despacha
              mensajes reales.
            </span>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={attemptSend.isPending}
            onClick={() => attemptSend.mutate(campaign.id)}
            data-testid={`sofia-crm-campaigns-attempt-send-${campaign.id}`}
          >
            {attemptSend.isPending ? 'Registrando intento…' : 'Intentar enviar'}
          </Button>

          {attempted ? (
            <div
              className="max-w-xs rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-right"
              data-testid={`sofia-crm-campaigns-attempt-result-${campaign.id}`}
            >
              <StatusBadge tone="blocked" label="Intento bloqueado" />
              <p className="mt-1 text-[11px] leading-5 text-red-800">
                {campaign.blockedReason ?? 'Envío real bloqueado por diseño — no se envió ningún mensaje de WhatsApp.'}
              </p>
            </div>
          ) : null}

          {attemptSend.isError && attemptSend.variables === campaign.id ? (
            <p className="max-w-xs text-right text-[11px] leading-5 text-red-700" data-testid={`sofia-crm-campaigns-attempt-error-${campaign.id}`}>
              {attemptSend.error instanceof ApiError ? attemptSend.error.message : 'No se pudo registrar el intento de envío.'}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
