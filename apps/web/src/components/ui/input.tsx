import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[13px] font-semibold leading-5 text-ink shadow-sm outline-none transition-all duration-200 placeholder:text-[13px] placeholder:font-medium placeholder:text-stone-400 hover:border-stone-300 focus:border-brand-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(255,159,28,0.12)] focus:outline-none disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-400',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
