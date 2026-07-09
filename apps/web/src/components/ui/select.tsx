import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative w-full">
    <select
      ref={ref}
      className={cn(
        'h-11 w-full appearance-none rounded-2xl border border-stone-200 bg-white px-4 pr-10 text-[13px] font-semibold leading-5 text-ink shadow-sm outline-none transition-all duration-200 hover:border-stone-300 focus:border-brand-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(255,159,28,0.12)] focus:outline-none disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-400',
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-stone-400">
      <ChevronDown className="h-4 w-4" aria-hidden="true" />
    </span>
  </div>
));

Select.displayName = 'Select';
