'use client';

import { CalendarClock, Layers, Megaphone, Send, ShieldBan } from 'lucide-react';
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
  const attemptFailed = attemptSend.isError && attemptSend.variables === campaign.id;

  return (
    <Card data-testid={`sofia-crm-campaigns-card-${campaign.id}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700"
            aria-hidden="true"
          >
            <Megaphone className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-bold leading-tight text-ink" data-testid="sofia-crm-campaigns-card-name">
                {campaign.name}
              </h3>
              <StatusBadge tone={CAMPAIGN_STATUS_TONE[campaign.status]} label={CAMPAIGN_STATUS_LABEL[campaign.status]} />
              <Badge tone="neutral">{campaign.channel}</Badge>
            </div>

            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-stone-600">
              <Layers className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
              Segmento: <span className="font-semibold text-stone-700">{campaign.segment?.name ?? 'Sin segmento'}</span>
            </p>

            <blockquote className="mt-2.5 rounded-xl border border-stone-100 bg-stone-50/70 px-3.5 py-2.5 text-[12.5px] italic leading-5.5 text-stone-700">
              “{campaign.messageTemplate}”
            </blockquote>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {campaign._count.deliveries} entrega{campaign._count.deliveries === 1 ? '' : 's'} registrada
                {campaign._count.deliveries === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Creada {formatDateTime(campaign.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2.5 lg:w-64 lg:items-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={attemptSend.isPending}
            onClick={() => attemptSend.mutate(campaign.id)}
            data-testid={`sofia-crm-campaigns-attempt-send-${campaign.id}`}
          >
            {attemptSend.isPending ? 'Registrando…' : 'Intentar enviar'}
          </Button>

          <p
            className="flex items-start gap-1.5 text-right text-[10.5px] leading-4.5 text-stone-500 lg:justify-end"
            data-testid={`sofia-crm-campaigns-block-notice-${campaign.id}`}
          >
            <ShieldBan className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
            Este botón solo registra un intento auditable — el envío real está bloqueado por diseño.
          </p>

          {attempted ? (
            <div
              className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-right"
              data-testid={`sofia-crm-campaigns-attempt-result-${campaign.id}`}
            >
              <div className="flex justify-end">
                <StatusBadge tone="blocked" label="Intento bloqueado" />
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-red-800">
                {campaign.blockedReason ?? 'Envío real bloqueado por diseño — no se envió ningún mensaje de WhatsApp.'}
              </p>
            </div>
          ) : null}

          {attemptFailed ? (
            <p className="text-right text-[11px] leading-5 text-red-700" data-testid={`sofia-crm-campaigns-attempt-error-${campaign.id}`}>
              {attemptSend.error instanceof ApiError ? attemptSend.error.message : 'No se pudo registrar el intento de envío.'}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
