import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Marca de identidad puntual del agente SOFIA. En variante `console` ya
 * no hace falta: el shell oscuro completo ES la identidad de SOFIA, así
 * que el chip solo aparece en `light` (CRM), donde el resto de la página
 * usa el mismo blanco que Inventario/Compras y necesita esa marca puntual.
 */
function SofiaModuleTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ink bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-400">
      SOFIA
    </span>
  );
}

/**
 * Encabezado único de cada página. Contiene la ÚNICA descripción de la
 * página — los componentes hijos (cards, paneles) no deben repetir esta
 * descripción con otras palabras; si necesitan contexto adicional, debe
 * ser información nueva, no una paráfrasis.
 *
 * `variant="console"`: usado exclusivamente por las 6 páginas de la Torre
 * de Control, dentro del shell oscuro violeta-carbón de `console-theme.ts`.
 * `variant="light"` (default): CRM y el resto de la app.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  statusBadges,
  actions,
  variant = 'light',
  className,
  'data-testid': testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  statusBadges?: ReactNode;
  actions?: ReactNode;
  variant?: 'light' | 'console';
  className?: string;
  'data-testid'?: string;
}) {
  const isConsole = variant === 'console';
  return (
    <header
      className={cn(
        'flex flex-col gap-3 rounded-2xl px-5 py-4 lg:flex-row lg:items-center lg:justify-between',
        isConsole ? 'border border-white/10 bg-white/[0.04]' : 'border border-stone-200/90 bg-white shadow-soft',
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              'text-[10px] font-semibold uppercase tracking-[0.22em]',
              isConsole ? 'text-brand-400' : 'text-brand-900',
            )}
          >
            {eyebrow}
          </p>
          {!isConsole && <SofiaModuleTag />}
          {statusBadges && <div className="flex flex-wrap items-center gap-1.5">{statusBadges}</div>}
        </div>
        <h1
          className={cn(
            'mt-1.5 text-[1.5rem] font-bold leading-tight tracking-tight lg:text-[1.7rem]',
            isConsole ? 'text-white' : 'text-ink',
          )}
        >
          {title}
        </h1>
        <p className={cn('mt-1 max-w-[64ch] text-[12.5px] leading-5.5', isConsole ? 'text-white/70' : 'text-stone-600')}>
          {description}
        </p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
