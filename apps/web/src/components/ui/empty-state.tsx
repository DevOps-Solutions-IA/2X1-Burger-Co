import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  description,
  action,
  className,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-[1.35rem] border border-dashed border-stone-200 bg-stone-50/85 px-5 py-5.5 text-center',
        className,
      )}
    >
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-[1rem] bg-white text-stone-400 shadow-sm" aria-hidden="true">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h2 className="mt-3 text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5.5 text-stone-600">{description}</p>
      {action ? <div className="mt-4.5 flex justify-center">{action}</div> : null}
    </div>
  );
}
