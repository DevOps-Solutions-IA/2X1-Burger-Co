import { Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';

/**
 * Aviso honesto para capacidades que aún no están conectadas a datos reales.
 * Nunca se usa para mostrar datos fabricados: comunica explícitamente que la
 * integración productiva llega en una fase posterior del programa.
 */
export function PhaseBoundaryNotice({
  title,
  description,
  pendingPhase,
  className,
  'data-testid': testId,
}: {
  title: string;
  description: string;
  pendingPhase: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[1.35rem] border border-dashed border-sofia-200 bg-sofia-50/60 px-5 py-6 text-center',
        className,
      )}
      data-testid={testId}
    >
      <div
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-[1rem] bg-white text-sofia-500 shadow-sm"
        aria-hidden="true"
      >
        <Clock3 className="h-5 w-5" />
      </div>
      <h2 className="mt-3 text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5.5 text-stone-600">{description}</p>
      <div className="mt-3.5 flex justify-center">
        <StatusBadge tone="pending" label={pendingPhase} />
      </div>
    </div>
  );
}
