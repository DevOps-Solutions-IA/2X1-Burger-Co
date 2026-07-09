import { cn } from '@/lib/utils';

export function Skeleton({
  className,
}: {
  className?: string;
}) {
  return <div className={cn('motion-safe:animate-pulse rounded-2xl bg-stone-100', className)} aria-hidden="true" />;
}
