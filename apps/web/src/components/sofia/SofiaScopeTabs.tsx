'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type SofiaScopeTabItem = {
  key: string;
  label: string;
  count?: number;
};

export type SofiaScopeTabsProps = {
  items: SofiaScopeTabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
  'data-testid'?: string;
};

export function SofiaScopeTabs({
  items,
  value,
  onChange,
  className,
  'data-testid': testId,
}: SofiaScopeTabsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid={testId} role="tablist">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'rounded-full border px-3 py-2 text-[11px] font-black transition-colors duration-150',
              active
                ? 'border-sofia-700 bg-sofia-700 text-white shadow-sm'
                : 'border-stone-200 bg-white text-stone-600 hover:border-sofia-200 hover:text-sofia-700',
            )}
            data-testid={testId ? `${testId}-${item.key}` : undefined}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('ml-1.5', active ? 'text-sofia-100' : 'text-stone-400')}>
                ({item.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
