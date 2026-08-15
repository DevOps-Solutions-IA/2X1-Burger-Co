'use client';

import { cn } from '@/lib/utils';
import type { SofiaCustomer360Section, SofiaCustomer360SectionKey } from '@/features/sofia/workspace/architecture';

export function Customer360Tabs({
  sections,
  active,
  onSelect,
  className,
  'data-testid': testId,
}: {
  sections: SofiaCustomer360Section[];
  active: SofiaCustomer360SectionKey;
  onSelect: (key: SofiaCustomer360SectionKey) => void;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div className={cn('flex gap-1.5 overflow-x-auto pb-1', className)} role="tablist" aria-label="Secciones de Customer 360" data-testid={testId}>
      {sections.map((section) => {
        const isActive = section.key === active;
        return (
          <button
            key={section.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(section.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              isActive
                ? 'border-sofia-600 bg-sofia-600 text-white shadow-sm'
                : 'border-stone-200 bg-white text-stone-600 hover:border-sofia-200 hover:text-sofia-700',
            )}
            data-testid={`sofia-customer360-tab-${section.key}`}
          >
            {section.label}
            {section.status === 'pending_phase' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none',
                  isActive ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-700',
                )}
              >
                Próxima fase
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
