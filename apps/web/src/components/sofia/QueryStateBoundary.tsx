import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Patrón único de loading/error para toda vista de la Torre de Control y
 * el CRM que consuma datos reales vía React Query. Nunca sustituye un
 * error o un estado de carga por datos fabricados.
 *
 * `variant="console"`: skeleton y estado de error legibles sobre el shell
 * oscuro de la Torre de Control.
 */
export function QueryStateBoundary<T>({
  isLoading,
  isError,
  error,
  data,
  loadingLabel,
  errorTitle,
  variant = 'light',
  'data-testid': testId,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  loadingLabel: string;
  errorTitle: string;
  variant?: 'light' | 'console';
  'data-testid'?: string;
  children: (data: T) => ReactNode;
}) {
  const isConsole = variant === 'console';

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-live="polite" data-testid={testId ? `${testId}-loading` : undefined}>
        <span className="sr-only">{loadingLabel}</span>
        <Skeleton className={cn('h-24 w-full rounded-2xl', isConsole && 'bg-white/[0.06]')} />
        <Skeleton className={cn('h-24 w-full rounded-2xl', isConsole && 'bg-white/[0.06]')} />
      </div>
    );
  }

  if (isError || !data) {
    const message = error instanceof ApiError ? error.message : 'No se pudo cargar la información desde el servidor.';
    return (
      <div
        className={cn(
          'rounded-2xl border px-5 py-5 text-center',
          isConsole ? 'border-red-400/25 bg-red-400/[0.06]' : 'border-red-200 bg-red-50',
        )}
        role="alert"
        data-testid={testId ? `${testId}-error` : undefined}
      >
        <div
          className={cn(
            'mx-auto flex h-9 w-9 items-center justify-center rounded-xl shadow-sm',
            isConsole ? 'bg-white/[0.06] text-red-300' : 'bg-white text-red-500',
          )}
          aria-hidden="true"
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className={cn('mt-3 text-[14px] font-semibold', isConsole ? 'text-red-200' : 'text-red-900')}>{errorTitle}</h2>
        <p className={cn('mx-auto mt-1.5 max-w-md text-[12.5px] leading-5.5', isConsole ? 'text-red-200/80' : 'text-red-700')}>
          {message}
        </p>
      </div>
    );
  }

  return <>{children(data)}</>;
}
