'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { findActiveSection, type SofiaWorkspaceSection } from '@/features/sofia/workspace/architecture';

export function WorkspaceTabs({
  sections,
  className,
  'data-testid': testId,
}: {
  sections: SofiaWorkspaceSection[];
  className?: string;
  'data-testid'?: string;
}) {
  const pathname = usePathname() ?? '';
  const active = findActiveSection(sections, pathname);

  return (
    <nav
      className={cn('flex gap-1.5 overflow-x-auto pb-1', className)}
      aria-label="Navegación del workspace SOFIA"
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
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              isActive
                ? 'border-sofia-600 bg-sofia-600 text-white shadow-sm'
                : 'border-stone-200 bg-white text-stone-600 hover:border-sofia-200 hover:text-sofia-700',
            )}
            data-testid={`sofia-workspace-tab-${section.key}`}
          >
            {section.label}
            {section.status === 'pending_phase' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none',
                  isActive ? 'bg-white text-sofia-700' : 'bg-stone-100 text-stone-700',
                )}
              >
                Próxima fase
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
