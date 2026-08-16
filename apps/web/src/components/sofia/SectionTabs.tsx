'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { findActiveSection, type SofiaNavSection } from '@/features/sofia/navigation';

export function SectionTabs({
  sections,
  className,
  'data-testid': testId,
}: {
  sections: SofiaNavSection[];
  className?: string;
  'data-testid'?: string;
}) {
  const pathname = usePathname() ?? '';
  const active = findActiveSection(sections, pathname);

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
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              isActive
                ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                : 'border-stone-200 bg-white text-stone-600 hover:border-brand-200',
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
