'use client';

import React, { type ReactNode } from 'react';
import { type LucideIcon, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SofiaStatusPill, type SofiaPillStatus } from './SofiaStatusPill';

export type SofiaOperatorTone = 'safe' | 'pending' | 'blocked' | 'off' | 'dryRun' | 'info';

const shellStyles: Record<SofiaOperatorTone, string> = {
  safe: 'border-emerald-200 bg-emerald-50/80 text-emerald-900',
  pending: 'border-amber-200 bg-amber-50/80 text-amber-900',
  blocked: 'border-red-200 bg-red-50/80 text-red-900',
  off: 'border-stone-200 bg-stone-50 text-stone-800',
  dryRun: 'border-teal-200 bg-teal-50/80 text-teal-900',
  info: 'border-sky-200 bg-sky-50/80 text-sky-900',
};

const iconStyles: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700',
  off: 'bg-stone-100 text-stone-600',
  dryRun: 'bg-teal-100 text-teal-700',
  info: 'bg-sky-100 text-sky-700',
};

const pillStatusByTone: Record<SofiaOperatorTone, SofiaPillStatus> = {
  safe: 'PASS',
  pending: 'WARNING',
  blocked: 'BLOCKED',
  off: 'NEUTRAL',
  dryRun: 'DRY_RUN',
  info: 'INFO',
};

export type SofiaStatusCardProps = {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone: SofiaOperatorTone;
  detail?: string;
  className?: string;
  'data-testid'?: string;
};

export function SofiaStatusCard({
  title,
  value,
  description,
  icon: Icon,
  tone,
  detail,
  className,
  'data-testid': testId,
}: SofiaStatusCardProps) {
  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-xl border p-4 shadow-sm',
        shellStyles[tone],
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-70">
            {title}
          </p>
          <p className="mt-2 break-words text-base font-black leading-tight sm:text-lg">{value}</p>
        </div>
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconStyles[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 opacity-75">{description}</p>
      {detail ? <p className="mt-2 text-[11px] font-bold opacity-60">{detail}</p> : null}
    </article>
  );
}

export type SofiaModeBadgeProps = {
  label: string;
  tone: SofiaOperatorTone;
  className?: string;
};

export function SofiaModeBadge({ label, tone, className }: SofiaModeBadgeProps) {
  return (
    <SofiaStatusPill
      status={pillStatusByTone[tone]}
      label={label}
      withDot
      className={cn('shadow-sm', className)}
    />
  );
}

export type SofiaRiskBadgeProps = {
  label: string;
  tone: SofiaOperatorTone;
  detail?: string;
};

export function SofiaRiskBadge({ label, tone, detail }: SofiaRiskBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-extrabold',
        shellStyles[tone],
      )}
      title={detail}
    >
      <span className={cn('h-2 w-2 rounded-full', iconStyles[tone].split(' ')[0])} />
      {label}
    </span>
  );
}

export type SofiaOperatorActionCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: SofiaOperatorTone;
  action?: ReactNode;
  'data-testid'?: string;
};

export function SofiaOperatorActionCard({
  title,
  description,
  icon: Icon,
  tone,
  action,
  'data-testid': testId,
}: SofiaOperatorActionCardProps) {
  return (
    <div className={cn('rounded-xl border p-4', shellStyles[tone])} data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconStyles[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black">{title}</p>
          <p className="mt-1 text-xs font-semibold leading-5 opacity-75">{description}</p>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export type SofiaTechnicalDetailsAccordionProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  'data-testid'?: string;
};

export function SofiaTechnicalDetailsAccordion({
  title = 'Detalle técnico',
  description = 'Códigos, reason codes y campos de auditoría para soporte.',
  children,
  defaultOpen = false,
  'data-testid': testId,
}: SofiaTechnicalDetailsAccordionProps) {
  return (
    <details
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm open:ring-1 open:ring-sofia-100"
      open={defaultOpen}
      data-testid={testId}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-black text-stone-900">{title}</span>
          <span className="mt-1 block text-xs font-semibold text-stone-500">{description}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-stone-400 transition-transform details-open:rotate-180" />
      </summary>
      <div className="mt-4 border-t border-stone-100 pt-4">{children}</div>
    </details>
  );
}

export function SofiaSafetyDecisionBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone: SofiaOperatorTone = normalized.includes('BLOCK') || normalized.includes('PAID')
    ? 'blocked'
    : normalized.includes('HUMAN') || normalized.includes('PAYMENT')
      ? 'pending'
      : normalized.includes('SUGGEST') || normalized.includes('DRAFT')
        ? 'dryRun'
        : 'info';
  return <SofiaRiskBadge label={status} tone={tone} />;
}

export function SofiaConversationStateBadge({ state }: { state: string }) {
  const normalized = state.toUpperCase();
  const tone: SofiaOperatorTone = normalized.includes('ACTIVE') || normalized.includes('RESOLVED')
    ? 'safe'
    : normalized.includes('HUMAN') || normalized.includes('PENDING')
      ? 'pending'
      : normalized.includes('BLOCK') || normalized.includes('FAILED') || normalized.includes('SENT')
        ? 'blocked'
        : 'info';
  return <SofiaRiskBadge label={state} tone={tone} />;
}
