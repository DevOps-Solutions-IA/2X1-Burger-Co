'use client';

import { LifeBuoy, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ValidationTabKey = 'commands' | 'cases';

const TABS: Array<{ key: ValidationTabKey; label: string; icon: typeof ShieldCheck }> = [
  { key: 'commands', label: 'Comandos', icon: ShieldCheck },
  { key: 'cases', label: 'Casos', icon: LifeBuoy },
];

/**
 * Selector de pestañas local de Validación — no es navegación de nivel
 * superior (esa es `SectionTabs`, ya usada por `ControlTowerFrame`).
 * Regla dura de accesibilidad: el hover se comunica solo con
 * borde/fondo/sombra, nunca combinando `transition-colors` con
 * `hover:text-*` (frame intermedio de contraste insuficiente en axe-core).
 */
export function ValidationTabs({
  active,
  onSelect,
  'data-testid': testId,
}: {
  active: ValidationTabKey;
  onSelect: (key: ValidationTabKey) => void;
  'data-testid'?: string;
}) {
  return (
    <div
      className="inline-flex gap-1 rounded-2xl border border-stone-200/90 bg-white p-1 shadow-soft"
      role="tablist"
      aria-label="Secciones de Validación"
      data-testid={testId}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-[background-color,border-color,box-shadow]',
              isActive
                ? 'bg-brand-500 text-ink shadow-soft'
                : 'border border-transparent text-stone-600 hover:border-stone-200 hover:bg-stone-50',
            )}
            data-testid={`sofia-validation-tab-${tab.key}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
