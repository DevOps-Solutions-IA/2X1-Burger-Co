import React, { type HTMLAttributes, type PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';

export const Card = React.memo(function Card({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-[1.45rem] border border-stone-200/90 bg-white p-4.5 shadow-soft md:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
});
