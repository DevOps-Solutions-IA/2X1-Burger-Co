'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { findActiveSection, type SofiaNavSection } from '@/features/sofia/navigation';

/**
 * Nunca animar el color del TEXTO en hover/focus (`transition-colors` +
 * `hover:text-*`) en este componente: axe-core puede capturar un frame
 * intermedio de la transición con peor contraste que cualquiera de los
 * dos extremos (ya causó un fallo real de CI). El estado hover se
 * comunica solo con borde/fondo, nunca con el color de texto.
 */
export function SectionTabs({
  sections,
  variant = 'light',
  className,
  'data-testid': testId,
}: {
  sections: SofiaNavSection[];
  variant?: 'light' | 'console';
  className?: string;
  'data-testid'?: string;
}) {
  const pathname = usePathname() ?? '';
  const active = findActiveSection(sections, pathname);
  const isConsole = variant === 'console';

  return (
    <nav
      className={cn('flex gap-1.5 overflow-x-auto pb-1', className)}
      aria-label="Navegación"
      data-testid={testId}
    >
      {sections.map((section) => {
        const isActive = section.key === active?.key;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12px] font-semibold transition-[background-color,border-color,box-shadow]',
              isConsole
                ? isActive
                  ? 'border-brand-400/40 bg-brand-400/15 text-brand-300 shadow-[0_0_0_1px_rgba(255,159,28,0.08)]'
                  : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.07]'
                : isActive
                  ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:bg-brand-50/60',
            )}
            data-testid={`sofia-nav-tab-${section.key}`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
