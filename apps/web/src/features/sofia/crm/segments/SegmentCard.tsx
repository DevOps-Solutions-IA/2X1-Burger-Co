import { Layers, Megaphone, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/sofia';
import type { SofiaStatusTone } from '@/components/sofia';
import { formatDate } from '@/lib/format';
import type { SofiaCrmSegment } from '@/features/sofia/contracts';

const SEGMENT_STATUS_LABEL: Record<SofiaCrmSegment['status'], string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  ARCHIVED: 'Archivado',
};

const SEGMENT_STATUS_TONE: Record<SofiaCrmSegment['status'], SofiaStatusTone> = {
  DRAFT: 'pending',
  ACTIVE: 'success',
  ARCHIVED: 'read_only',
};

export function SegmentCard({ segment }: { segment: SofiaCrmSegment }) {
  return (
    <Card data-testid="sofia-crm-segments-card">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700" aria-hidden="true">
          <Layers className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-[14px] font-extrabold leading-snug text-ink">{segment.name}</p>
            <StatusBadge tone={SEGMENT_STATUS_TONE[segment.status]} label={SEGMENT_STATUS_LABEL[segment.status]} />
          </div>
        </div>
      </div>

      <p className="mt-3 break-words text-[12.5px] leading-5.5 text-stone-600">
        {segment.description ?? 'Sin descripción registrada.'}
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-4 border-t border-stone-100 pt-3.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <Users className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
          {segment._count.memberships} miembros
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <Megaphone className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
          {segment._count.campaigns} campañas
        </span>
      </div>
      <p className="mt-2 text-[11px] font-medium text-stone-500">Creado {formatDate(segment.createdAt)}</p>
    </Card>
  );
}
