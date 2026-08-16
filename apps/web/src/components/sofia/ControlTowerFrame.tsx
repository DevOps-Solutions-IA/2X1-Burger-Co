import type { ReactNode } from 'react';
import { SectionTabs } from './SectionTabs';
import { SOFIA_CONTROL_TOWER_SECTIONS } from '@/features/sofia/navigation';

/** Envoltorio compartido por las secciones de la Torre de Control SOFIA. */
export function ControlTowerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4" data-testid="sofia-control-tower">
      <SectionTabs sections={SOFIA_CONTROL_TOWER_SECTIONS} data-testid="sofia-control-tower-tabs" />
      {children}
    </div>
  );
}
