import { Circle, CircleAlert, CircleCheck, CircleHelp, Clock3, ShieldAlert } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';

export type ProductStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<ProductStatusTone, string> = {
  neutral: 'border-line bg-canvas text-muted',
  success: 'border-signal-success/25 bg-signal-success/10 text-signal-success',
  warning: 'border-signal-warning/30 bg-signal-warning/10 text-signal-warning',
  danger: 'border-signal-danger/25 bg-signal-danger/10 text-signal-danger',
  info: 'border-signal-info/25 bg-signal-info/10 text-signal-info',
};

const toneIcons: Record<ProductStatusTone, ComponentType<SVGProps<SVGSVGElement>>> = {
  neutral: Circle,
  success: CircleCheck,
  warning: CircleAlert,
  danger: ShieldAlert,
  info: CircleHelp,
};

const knownStatusTones: Record<string, ProductStatusTone> = {
  ACTIVE: 'success',
  AVAILABLE: 'success',
  COMPLETED: 'success',
  DELIVERED: 'success',
  PAID: 'success',
  READY: 'success',
  RESOLVED: 'success',
  SUCCEEDED: 'success',
  CANCELLED: 'danger',
  FAILED: 'danger',
  PAYMENT_ISSUE: 'danger',
  REJECTED: 'danger',
  BLOCKED: 'danger',
  EXPIRED: 'warning',
  FINANCIAL_REVIEW_REQUIRED: 'warning',
  HUMAN_REQUIRED: 'warning',
  PENDING: 'warning',
  UNKNOWN_RESULT: 'warning',
  CLAIMED: 'info',
  IN_PREPARATION: 'info',
  IN_TRANSIT: 'info',
  OPEN: 'info',
};

export function statusTone(status: string): ProductStatusTone {
  return knownStatusTones[status.trim().toUpperCase()] ?? 'neutral';
}

export function StatusBadge({
  status,
  label,
  tone = statusTone(status),
  onDark = false,
  className,
}: {
  status: string;
  label?: string;
  tone?: ProductStatusTone;
  onDark?: boolean;
  className?: string;
}) {
  const Icon = toneIcons[tone] ?? Clock3;
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
        toneStyles[tone],
        onDark && 'text-white',
        className,
      )}
      data-status={status}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label ?? status.replaceAll('_', ' ')}</span>
    </span>
  );
}
