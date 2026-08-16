import { Users, Megaphone } from 'lucide-react';
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
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[14px] font-extrabold text-ink">{segment.name}</p>
        <StatusBadge tone={SEGMENT_STATUS_TONE[segment.status]} label={SEGMENT_STATUS_LABEL[segment.status]} />
      </div>
      <p className="mt-1.5 min-h-[1.5em] text-[12.5px] leading-5 text-stone-600">
        {segment.description ?? 'Sin descripción registrada.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-stone-100 pt-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <Users className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
          {segment._count.memberships} miembros
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <Megaphone className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
          {segment._count.campaigns} campañas
        </span>
      </div>
      <p className="mt-2 text-[11px] text-stone-500">Creado {formatDate(segment.createdAt)}</p>
    </Card>
  );
}
