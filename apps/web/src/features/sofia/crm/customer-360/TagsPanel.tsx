import { Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { formatDate } from '@/lib/format';

export function TagsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card data-testid="sofia-customer360-tags-panel">
      <h3 className="text-[13.5px] font-extrabold text-ink">Tags del cliente</h3>
      <p className="mt-0.5 text-[12px] text-stone-600">Etiquetas asignadas a este cliente en el CRM.</p>

      {customer.tags.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={<Tag className="h-5 w-5" />} title="Sin tags" description="Este cliente no tiene tags asignados todavía." />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {customer.tags.map((tag) => (
            <li key={tag.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
              <Badge tone="neutral">{tag.name}</Badge>
              <span className="text-[11px] text-stone-600">Asignado {formatDate(tag.assignedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
