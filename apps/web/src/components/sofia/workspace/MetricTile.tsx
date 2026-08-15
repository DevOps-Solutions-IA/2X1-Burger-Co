import type { LucideIcon } from 'lucide-react';
import { MetricCard } from '@/components/ui/metric-card';

const TONE_TO_ACCENT = {
  neutral: 'ink',
  sofia: 'brand',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
} as const satisfies Record<string, 'brand' | 'success' | 'danger' | 'ink' | 'warning'>;

/**
 * Tile de una métrica real proveniente del backend. Nunca recibe valores
 * fabricados. Envuelve el `MetricCard` compartido con el resto del sistema
 * (POS, caja, inventario) para que SOFIA use exactamente la misma identidad
 * visual, no una reimplementación paralela.
 */
export function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
  className,
  'data-testid': testId,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONE_TO_ACCENT;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div data-testid={testId}>
      <MetricCard
        label={label}
        value={String(value)}
        hint={detail}
        icon={Icon ? <Icon className="h-4 w-4" /> : undefined}
        accent={TONE_TO_ACCENT[tone]}
        className={className}
        compact
      />
    </div>
  );
}
