'use client';

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaSandboxCaseResult = 'PASS' | 'FAIL' | 'PENDING';

export type SofiaSandboxCaseCardProps = {
  title: string;
  description: string;
  inputPreview?: string;
  result: SofiaSandboxCaseResult;
  resultDetail?: string;
  className?: string;
  'data-testid'?: string;
};

const resultStyles: Record<SofiaSandboxCaseResult, { shell: string; badge: string; label: string }> = {
  PASS: { shell: 'border-emerald-200 bg-emerald-50/60', badge: 'bg-emerald-100 text-emerald-700', label: 'PASS' },
  FAIL: { shell: 'border-red-200 bg-red-50/60', badge: 'bg-red-100 text-red-700', label: 'FAIL' },
  PENDING: { shell: 'border-stone-200 bg-stone-50', badge: 'bg-stone-100 text-stone-500', label: 'Pendiente' },
};

export function SofiaSandboxCaseCard({
  title,
  description,
  inputPreview,
  result,
  resultDetail,
  className,
  'data-testid': testId,
}: SofiaSandboxCaseCardProps) {
  const styles = resultStyles[result];
  const Icon = result === 'PASS' ? CheckCircle2 : result === 'FAIL' ? XCircle : undefined;

  return (
    <div className={cn('rounded-2xl border p-4', styles.shell, className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-stone-900">{title}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-stone-600">{description}</p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]',
            styles.badge,
          )}
        >
          {Icon && <Icon className="h-3 w-3" />}
          {styles.label}
        </span>
      </div>
      {inputPreview && (
        <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[11px] font-semibold text-stone-600">
          {inputPreview}
        </p>
      )}
      {resultDetail && <p className="mt-2 text-[11px] font-bold text-stone-500">{resultDetail}</p>}
    </div>
  );
}
