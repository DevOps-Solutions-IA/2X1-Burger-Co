import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';

/**
 * Patrón único de loading/error/empty para toda vista SOFIA/CRM que consume
 * datos reales vía React Query. Nunca sustituye un error o un estado de
 * carga por datos fabricados: si el backend no respondió con éxito, se
 * muestra el error real devuelto por `apiFetchSchema`.
 */
export function QueryStateBoundary<T>({
  isLoading,
  isError,
  error,
  data,
  loadingLabel,
  errorTitle,
  'data-testid': testId,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  loadingLabel: string;
  errorTitle: string;
  'data-testid'?: string;
  children: (data: T) => ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-live="polite" data-testid={testId ? `${testId}-loading` : undefined}>
        <span className="sr-only">{loadingLabel}</span>
        <Skeleton className="h-24 w-full rounded-[1.35rem]" />
        <Skeleton className="h-24 w-full rounded-[1.35rem]" />
      </div>
    );
  }

  if (isError || !data) {
    const message = error instanceof ApiError ? error.message : 'No se pudo cargar la información desde el servidor.';
    return (
      <div
        className="rounded-[1.35rem] border border-red-200 bg-red-50 px-5 py-5 text-center"
        role="alert"
        data-testid={testId ? `${testId}-error` : undefined}
      >
        <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-[1rem] bg-white text-red-500 shadow-sm" aria-hidden="true">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-3 text-[14px] font-semibold text-red-900">{errorTitle}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5.5 text-red-700">{message}</p>
      </div>
    );
  }

  return <>{children(data)}</>;
}
