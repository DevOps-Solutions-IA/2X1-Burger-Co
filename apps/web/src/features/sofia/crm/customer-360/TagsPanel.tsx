import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia/workspace';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';

export function TagsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  return (
    <Card data-testid="sofia-customer360-tags">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">Tags</p>
      <h2 className="text-[15px] font-semibold text-ink">Etiquetas asignadas</h2>

      {customer.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {customer.tags.map((tag) => (
            <StatusBadge key={tag.id} tone="read_only" label={tag.name} withDot={false} />
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState title="Sin tags" description="Este cliente no tiene etiquetas asignadas todavía." />
        </div>
      )}
    </Card>
  );
}
