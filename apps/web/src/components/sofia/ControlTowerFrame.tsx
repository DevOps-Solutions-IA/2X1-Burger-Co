import type { ReactNode } from 'react';
import { SectionTabs } from './SectionTabs';
import { CONSOLE_SHELL_CLASS } from './console-theme';
import { SOFIA_CONTROL_TOWER_SECTIONS } from '@/features/sofia/navigation';

/**
 * Envoltorio compartido por las secciones de la Torre de Control SOFIA.
 * Negro plano, idéntico al del sidebar/barra superior de `app-shell.tsx`
 * — este es el único lugar de la Torre de Control con este fondo; el
 * CRM y el resto del sistema (Inventario, POS, Caja) permanecen en el
 * tema claro de siempre.
 */
export function ControlTowerFrame({ children }: { children: ReactNode }) {
  return (
    <div className={CONSOLE_SHELL_CLASS} data-testid="sofia-control-tower">
      <div className="space-y-4">
        <SectionTabs sections={SOFIA_CONTROL_TOWER_SECTIONS} variant="console" data-testid="sofia-control-tower-tabs" />
        {children}
      </div>
    </div>
  );
}
