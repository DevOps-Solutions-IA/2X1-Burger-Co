import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Marca de identidad puntual del agente SOFIA — único uso legítimo del
 * acento violeta `sofia-*` en toda la Torre de Control/CRM. El `eyebrow`
 * de la página NUNCA debe repetir la palabra "SOFIA" — este chip ya la
 * comunica, evitando la redundancia "CRM SOFIA [SOFIA]".
 */
function SofiaModuleTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sofia-200 bg-sofia-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sofia-700">
      SOFIA
    </span>
  );
}

/**
 * Encabezado único de cada página. Contiene la ÚNICA descripción de la
 * página — los componentes hijos (cards, paneles) no deben repetir esta
 * descripción con otras palabras; si necesitan contexto adicional, debe
 * ser información nueva, no una paráfrasis.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  statusBadges,
  actions,
  className,
  'data-testid': testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  statusBadges?: ReactNode;
  actions?: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-stone-200/90 bg-white px-5 py-4 shadow-soft lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-900">{eyebrow}</p>
          <SofiaModuleTag />
          {statusBadges && <div className="flex flex-wrap items-center gap-1.5">{statusBadges}</div>}
        </div>
        <h1 className="mt-1.5 text-[1.5rem] font-bold leading-tight tracking-tight text-ink lg:text-[1.7rem]">{title}</h1>
        <p className="mt-1 max-w-[64ch] text-[12.5px] leading-5.5 text-stone-600">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
