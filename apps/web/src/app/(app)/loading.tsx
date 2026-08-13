import { Skeleton } from '@/components/ui/skeleton';

export default function OperationalLoading() {
  return (
    <div className="space-y-6 p-5 sm:p-7 lg:p-9" role="status" aria-label="Cargando modulo operativo">
      <span className="sr-only">Cargando informacion operativa.</span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
