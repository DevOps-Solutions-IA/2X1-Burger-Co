import type { ReactNode } from 'react';
import { AlertTriangle, LockKeyhole, RotateCcw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type QueryStatus = 'ready' | 'loading' | 'empty' | 'error' | 'permission_denied';

export interface QueryStateProps {
  status: QueryStatus;
  children?: ReactNode;
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: ReactNode;
  skeletonRows?: number;
  className?: string;
}

export function QueryState({
  status,
  children,
  title,
  description,
  onRetry,
  action,
  skeletonRows = 5,
  className,
}: QueryStateProps) {
  if (status === 'ready') return <>{children}</>;

  if (status === 'loading') {
    return (
      <div className={cn('space-y-3 rounded-2xl border border-line bg-panel p-4', className)} aria-busy="true" aria-label={title ?? 'Cargando información'}>
        {Array.from({ length: skeletonRows }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-xl bg-line/45" />
        ))}
        <span className="sr-only">{title ?? 'Cargando información'}</span>
      </div>
    );
  }

  const permissionDenied = status === 'permission_denied';
  const isError = status === 'error';
  const Icon = permissionDenied ? LockKeyhole : isError ? AlertTriangle : SearchX;
  const fallbackTitle = permissionDenied
    ? 'No tienes acceso a esta información'
    : isError
      ? 'No pudimos cargar la información'
      : 'No hay resultados todavía';
  const fallbackDescription = permissionDenied
    ? 'Tu rol no incluye este módulo o esta acción.'
    : isError
      ? 'La información no está disponible. No mostramos ceros ni datos estimados como reemplazo.'
      : 'Ajusta los filtros o vuelve cuando exista actividad real.';

  return (
    <div
      className={cn('rounded-2xl border border-dashed border-line bg-panel px-5 py-10 text-center', className)}
      role={isError ? 'alert' : 'status'}
    >
      <Icon className={cn('mx-auto h-7 w-7', isError ? 'text-signal-danger' : 'text-muted')} aria-hidden="true" />
      <h2 className="mt-3 font-heading text-base font-semibold text-ink">{title ?? fallbackTitle}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{description ?? fallbackDescription}</p>
      {onRetry || action ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
