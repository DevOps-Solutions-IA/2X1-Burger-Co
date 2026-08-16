'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/sofia';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { formatDate } from '@/lib/format';
import type { SofiaCrmLeadSummary, SofiaCrmPipelineStage } from '@/features/sofia/contracts';
import { CRM_LEAD_SOURCE_LABEL, CRM_LEAD_STATUS_LABEL, leadStatusTone } from './lead-display';
import { TransitionLeadForm } from './TransitionLeadForm';

export function LeadCard({ lead, stages }: { lead: SofiaCrmLeadSummary; stages: SofiaCrmPipelineStage[] }) {
  const [isTransitioning, setIsTransitioning] = useState(false);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3.5" data-testid="sofia-crm-pipeline-lead-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-extrabold text-ink">{lead.title}</p>
        <StatusBadge tone={leadStatusTone(lead.status)} label={CRM_LEAD_STATUS_LABEL[lead.status] ?? lead.status} />
      </div>
      <p className="mt-1 truncate text-[12px] font-semibold text-stone-700">{customerDisplayName(lead.customer.displayName)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="neutral">{CRM_LEAD_SOURCE_LABEL[lead.source] ?? lead.source}</Badge>
        <Badge tone="neutral">{lead.owner ? lead.owner.fullName : 'Sin responsable'}</Badge>
      </div>
      <p className="mt-2 text-[11px] text-stone-500">Actualizado {formatDate(lead.updatedAt)}</p>

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
