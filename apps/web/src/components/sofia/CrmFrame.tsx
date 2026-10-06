import type { ReactNode } from 'react';
import { SectionTabs } from './SectionTabs';
import { SOFIA_CRM_SECTIONS } from '@/features/sofia/navigation';

/** Envoltorio compartido por las secciones del CRM SOFIA. */
export function CrmFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4" data-testid="sofia-crm-frame">
      <SectionTabs sections={SOFIA_CRM_SECTIONS} data-testid="sofia-crm-tabs" />
      {children}
    </div>
  );
}
