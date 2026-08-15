import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold leading-none text-center transition motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:pointer-events-none disabled:opacity-70',
  {
    variants: {
      variant: {
        default: 'bg-brand-500 text-ink shadow-soft hover:bg-brand-600 active:bg-brand-700',
        secondary: 'bg-white text-ink ring-1 ring-stone-200 hover:bg-stone-50',
        ghost: 'bg-transparent text-stone-600 hover:bg-stone-100 hover:text-ink',
      },
      size: {
        default: 'h-11 min-w-[8.75rem] px-5',
        sm: 'h-11 min-w-[7.25rem] px-4 text-[13px]',
        lg: 'h-12 min-w-[10rem] px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.memo(function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
