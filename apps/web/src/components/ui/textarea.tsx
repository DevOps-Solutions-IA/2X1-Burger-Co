import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-[14px] leading-6 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] outline-none transition placeholder:text-[13px] placeholder:text-stone-400 focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-500',
        className,
      )}
      {...props}
  />
));

Textarea.displayName = 'Textarea';
