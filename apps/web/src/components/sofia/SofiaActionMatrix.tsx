'use client';

import React from 'react';
import { Ban, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaActionMatrixProps = {
  allowed: string[];
  blocked: string[];
  className?: string;
  'data-testid'?: string;
};

export function SofiaActionMatrix({ allowed, blocked, className, 'data-testid': testId }: SofiaActionMatrixProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)} data-testid={testId}>
      <SofiaActionMatrixCard tone="allowed" items={allowed} />
      <SofiaActionMatrixCard tone="blocked" items={blocked} />
    </div>
  );
}

export type SofiaActionMatrixCardProps = {
  tone: 'allowed' | 'blocked';
  items: string[];
  className?: string;
  'data-testid'?: string;
};

const cardStyles = {
  allowed: {
    shell: 'border-emerald-200 bg-emerald-50/60',
    label: 'text-emerald-700',
    item: 'text-emerald-900',
    icon: 'text-emerald-600',
    title: 'Permitido',
    Icon: CheckCircle2,
  },
  blocked: {
    shell: 'border-red-200 bg-red-50/60',
    label: 'text-red-700',
    item: 'text-red-900',
    icon: 'text-red-600',
    title: 'Bloqueado',
    Icon: Ban,
  },
} as const;

export function SofiaActionMatrixCard({ tone, items, className, 'data-testid': testId }: SofiaActionMatrixCardProps) {
  const styles = cardStyles[tone];
  return (
    <div className={cn('rounded-xl border p-4', styles.shell, className)} data-testid={testId}>
      <p className={cn('mb-2.5 text-[11px] font-black uppercase tracking-[0.14em]', styles.label)}>{styles.title}</p>
      <div className="grid gap-1.5">
        {items.map((item) => (
          <div key={item} className={cn('flex items-center gap-2 text-sm font-semibold', styles.item)}>
            <styles.Icon className={cn('h-3.5 w-3.5 shrink-0', styles.icon)} />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
