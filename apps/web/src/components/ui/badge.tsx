import React from 'react';
import { cn } from '@/lib/utils';

export const Badge = React.memo(function Badge({
  children,
  tone = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  children: React.ReactNode;
  tone?: 'default' | 'danger' | 'success' | 'warning' | 'info' | 'neutral';
}) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none tracking-[0.04em]',
        tone === 'default' && 'bg-brand-100 text-ink',
        tone === 'danger' && 'border-red-100 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-100 bg-emerald-50 text-emerald-800',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
        tone === 'info' && 'border-sky-100 bg-sky-50 text-sky-700',
        tone === 'neutral' && 'border-stone-200 bg-stone-100 text-stone-700',
        className,
      )}
    >
      {children}
    </span>
  );
});
