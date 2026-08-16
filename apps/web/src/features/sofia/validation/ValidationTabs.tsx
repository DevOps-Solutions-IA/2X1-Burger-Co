'use client';

import { cn } from '@/lib/utils';

export type ValidationTabKey = 'commands' | 'cases';

const TABS: Array<{ key: ValidationTabKey; label: string }> = [
  { key: 'commands', label: 'Comandos' },
  { key: 'cases', label: 'Casos' },
];

export function ValidationTabs({
  active,
  onSelect,
}: {
  active: ValidationTabKey;
  onSelect: (key: ValidationTabKey) => void;
}) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Secciones de Validación"
      data-testid="sofia-validation-tabs"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
              isActive
                ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                : 'border-stone-200 bg-white text-stone-600 hover:border-brand-200 hover:text-brand-700',
            )}
            data-testid={`sofia-validation-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
