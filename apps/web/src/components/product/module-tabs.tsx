import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ModuleTabItem {
  id: string;
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
  count?: number;
  icon?: ReactNode;
}

export function ModuleTabs({ items, label, className, density = 'comfortable' }: { items: readonly ModuleTabItem[]; label: string; className?: string; density?: 'comfortable' | 'compact' }) {
  return (
    <nav aria-label={label} className={cn('overflow-x-auto border-b border-line', className)}>
      <ul className="flex min-w-max gap-1" role="list">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.disabled ? '#' : item.href}
              aria-current={item.active ? 'page' : undefined}
              aria-disabled={item.disabled || undefined}
              tabIndex={item.disabled ? -1 : undefined}
              className={cn(
                'relative flex min-h-11 items-center gap-2 rounded-t-lg text-sm font-semibold text-muted transition-colors',
                density === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                item.active && 'bg-panel text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand-600',
                !item.active && !item.disabled && 'hover:bg-panel hover:text-ink',
                item.disabled && 'cursor-not-allowed opacity-45',
              )}
              onClick={item.disabled ? (event) => event.preventDefault() : undefined}
            >
              {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
              <span>{item.label}</span>
              {typeof item.count === 'number' ? (
                <span className="min-w-6 rounded-full border border-line bg-canvas px-1.5 py-0.5 text-center text-xs tabular-nums text-muted">
                  {item.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
