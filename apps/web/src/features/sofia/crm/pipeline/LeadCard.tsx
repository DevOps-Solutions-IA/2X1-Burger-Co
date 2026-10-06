'use client';

import { useState } from 'react';
import { ArrowRight, Headset, MessageCircle, ShoppingBag, Truck, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/sofia';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { formatDate } from '@/lib/format';
import type { SofiaCrmLeadSummary, SofiaCrmPipelineStage } from '@/features/sofia/contracts';
import { CRM_LEAD_SOURCE_LABEL, CRM_LEAD_STATUS_LABEL, initialsFromName, leadStatusTone } from './lead-display';
import { TransitionLeadForm } from './TransitionLeadForm';

const SOURCE_ICON: Record<string, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  POS: ShoppingBag,
  DELIVERY: Truck,
  CUSTOMER_SERVICE: Headset,
  AUTHORIZED_OPERATOR: UserCog,
};

export function LeadCard({ lead, stages }: { lead: SofiaCrmLeadSummary; stages: SofiaCrmPipelineStage[] }) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const customerName = customerDisplayName(lead.customer.displayName);
  const SourceIcon = SOURCE_ICON[lead.source] ?? MessageCircle;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" data-testid="sofia-crm-pipeline-lead-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[13.5px] font-bold leading-snug text-ink">{lead.title}</p>
        <StatusBadge tone={leadStatusTone(lead.status)} label={CRM_LEAD_STATUS_LABEL[lead.status] ?? lead.status} />
      </div>

      <div className="mt-2.5 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-[10px] font-bold text-stone-600"
          aria-hidden="true"
        >
          {initialsFromName(customerName)}
        </span>
        <p className="min-w-0 break-words text-[12.5px] font-semibold leading-snug text-stone-700">{customerName}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="neutral" className="inline-flex items-center gap-1">
          <SourceIcon className="h-3 w-3" aria-hidden="true" />
          {CRM_LEAD_SOURCE_LABEL[lead.source] ?? lead.source}
        </Badge>
        <Badge tone="neutral">{lead.owner ? lead.owner.fullName : 'Sin responsable'}</Badge>
      </div>

      <p className="mt-2.5 border-t border-stone-100 pt-2.5 text-[11px] font-medium text-stone-500">
        Actualizado {formatDate(lead.updatedAt)}
      </p>

      {isTransitioning ? (
        <TransitionLeadForm lead={lead} stages={stages} onClose={() => setIsTransitioning(false)} />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => setIsTransitioning(true)}
          data-testid="sofia-crm-pipeline-lead-move"
        >
          Mover
          <ArrowRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
