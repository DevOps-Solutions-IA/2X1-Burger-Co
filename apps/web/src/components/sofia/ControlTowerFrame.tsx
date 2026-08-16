import type { ReactNode } from 'react';
import { SectionTabs } from './SectionTabs';
import { CONSOLE_GRID_OVERLAY_CLASS, CONSOLE_SHELL_CLASS } from './console-theme';
import { SOFIA_CONTROL_TOWER_SECTIONS } from '@/features/sofia/navigation';

/**
 * Envoltorio compartido por las secciones de la Torre de Control SOFIA.
 * Shell oscuro violeta-carbón (`console-theme.ts`) — este es el único
 * lugar de toda la app con este fondo; el CRM y el resto del sistema
 * (Inventario, POS, Caja) permanecen en el tema claro de siempre.
 */
export function ControlTowerFrame({ children }: { children: ReactNode }) {
  return (
    <div className={CONSOLE_SHELL_CLASS} data-testid="sofia-control-tower">
      <div className={CONSOLE_GRID_OVERLAY_CLASS} aria-hidden="true" />
      <div className="space-y-4">
        <SectionTabs sections={SOFIA_CONTROL_TOWER_SECTIONS} variant="console" data-testid="sofia-control-tower-tabs" />
        {children}
      </div>
    </div>
  );
}
