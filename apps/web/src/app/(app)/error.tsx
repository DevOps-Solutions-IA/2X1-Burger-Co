'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OperationalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The global logger captures technical context; the UI exposes no stack or internal metadata.
    console.error('Operational route rendering failed', { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[65vh] items-center justify-center p-5 sm:p-8">
      <section className="w-full max-w-xl rounded-[1.75rem] border border-red-200 bg-panel p-7 shadow-soft sm:p-9" aria-labelledby="route-error-title">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-signal-danger">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-signal-danger">Modulo no disponible</p>
        <h1 id="route-error-title" className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">
          No pudimos mostrar esta operacion
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          No sustituimos la informacion con valores de ejemplo. Reintenta cuando el servicio vuelva a responder.
        </p>
        <Button type="button" className="mt-6 min-h-11" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </Button>
      </section>
    </div>
  );
}
