import Link from 'next/link';
import { ArrowUpRight, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { formatDate } from '@/lib/format';

const SEGMENT_STATUS_TONE: Record<'DRAFT' | 'ACTIVE' | 'ARCHIVED', SofiaStatusTone> = {
  DRAFT: 'pending',
  ACTIVE: 'success',
  ARCHIVED: 'read_only',
};

const SEGMENT_STATUS_LABEL: Record<'DRAFT' | 'ACTIVE' | 'ARCHIVED', string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  ARCHIVED: 'Archivado',
};

export function SegmentsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card data-testid="sofia-customer360-segments-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Segmentos</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">
            Segmentos de clientes a los que pertenece este cliente. La gestión de segmentos vive en{' '}
            <Link href="/sofia/crm/segments" className="font-semibold text-brand-700 hover:text-brand-900">
              Segmentos
            </Link>
            .
          </p>
        </div>
        <Layers className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
      </div>

      {customer.segments.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={<Layers className="h-5 w-5" aria-hidden="true" />} title="Sin segmentos" description="Este cliente no pertenece a ningún segmento todavía." />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {customer.segments.map((segment) => (
            <li key={segment.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
              <div>
                <p className="text-[13px] font-bold text-ink">{segment.name}</p>
                <p className="text-[11px] text-stone-600">Añadido {formatDate(segment.addedAt)}</p>
              </div>
              <StatusBadge tone={SEGMENT_STATUS_TONE[segment.status]} label={SEGMENT_STATUS_LABEL[segment.status]} />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/sofia/crm/segments"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900"
        data-testid="sofia-customer360-segments-link"
      >
        Ver todos los segmentos
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Card>
  );
}
