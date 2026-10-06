'use client';

import { cn } from '@/lib/utils';
import type { SofiaCustomer360Section, SofiaCustomer360SectionKey } from '@/features/sofia/navigation';

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
              'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12px] font-semibold transition-[background-color,border-color,box-shadow]',
              isActive
                ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:bg-brand-50/60',
            )}
            data-testid={`sofia-customer360-tab-${section.key}`}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
