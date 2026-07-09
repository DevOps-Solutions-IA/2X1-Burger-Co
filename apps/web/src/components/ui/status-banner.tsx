import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'warning' | 'success' | 'danger';

const toneStyles: Record<Tone, string> = {
  info: 'border-sky-100 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-900',
  danger: 'border-red-100 bg-red-50 text-red-900',
};

const toneIcons: Record<Tone, ReactNode> = {
  info: <Info className="h-5 w-5" />,
  warning: <TriangleAlert className="h-5 w-5" />,
  success: <CheckCircle2 className="h-5 w-5" />,
  danger: <AlertCircle className="h-5 w-5" />,
};

export function StatusBanner({
  tone = 'info',
  title,
  description,
  action,
  className,
}: {
  tone?: Tone;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" className={cn('rounded-[1.35rem] border px-4 py-3.5 md:px-4.5 md:py-4', toneStyles[tone], className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[1rem] border border-current/10 bg-white/55">
            <span aria-hidden="true">{toneIcons[tone]}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-5">{title}</p>
            <p className="mt-1 text-[12.5px] leading-5.5 opacity-90">{description}</p>
          </div>
        </div>
        {action ? <div className="shrink-0 self-start lg:self-center">{action}</div> : null}
      </div>
    </div>
  );
}
