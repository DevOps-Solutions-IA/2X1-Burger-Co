import { Clock3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from './StatusBadge';

/**
 * Aviso honesto para capacidades que aún no están conectadas a datos reales.
 * Nunca se usa para mostrar datos fabricados: comunica explícitamente por qué
 * (falta de endpoint HTTP, falta de correlación, etc.) y en qué fase del
 * programa llega. Reutiliza el `EmptyState` compartido con el resto del
 * sistema en vez de un componente paralelo.
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
    <div data-testid={testId}>
      <EmptyState
        icon={<Clock3 className="h-5 w-5" />}
        title={title}
        description={description}
        action={<StatusBadge tone="pending" label={pendingPhase} />}
        className={className}
      />
    </div>
  );
}
