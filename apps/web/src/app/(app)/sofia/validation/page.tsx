'use client';

import { useState } from 'react';
import { ControlTowerFrame, PageHeader } from '@/components/sofia';
import { ValidationTabs, type ValidationTabKey } from '@/features/sofia/validation/ValidationTabs';
import { CommandsPanel } from '@/features/sofia/validation/CommandsPanel';
import { CasesPanel } from '@/features/sofia/validation/CasesPanel';

export default function SofiaValidationPage() {
  const [tab, setTab] = useState<ValidationTabKey>('commands');

  return (
    <ControlTowerFrame>
      <div className="space-y-5" data-testid="sofia-validation-page">
        <PageHeader
          eyebrow="Torre de Control"
          title="Validación"
          description="Aprueba o rechaza comandos gobernados de SOFIA (SecureCommand) y gestiona las escalaciones de servicio al cliente que requieren intervención humana."
          data-testid="sofia-validation-header"
        />

        <ValidationTabs active={tab} onSelect={setTab} data-testid="sofia-validation-tabs" />

        {tab === 'commands' ? <CommandsPanel /> : <CasesPanel />}
      </div>
    </ControlTowerFrame>
  );
}
