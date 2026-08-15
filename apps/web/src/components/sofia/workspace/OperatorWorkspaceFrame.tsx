import type { ReactNode } from 'react';
import { WorkspaceTabs } from './WorkspaceTabs';
import { SOFIA_OPERATOR_SECTIONS } from '@/features/sofia/workspace/architecture';

/** Envoltorio compartido por las 9 secciones del workspace operativo SOFIA. */
export function OperatorWorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4" data-testid="sofia-operator-workspace">
      <WorkspaceTabs sections={SOFIA_OPERATOR_SECTIONS} data-testid="sofia-operator-tabs" />
      {children}
    </div>
  );
}
