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
          description="Antes de que SOFIA toque el sistema real (pedidos, pagos, stock, caja o WhatsApp), cada acción pasa por aquí para tu aprobación. SOFIA no tiene comandas propias: pide ejecutar acciones en los sistemas reales."
          data-testid="sofia-validation-header"
        />

        <ValidationTabs active={tab} onSelect={setTab} data-testid="sofia-validation-tabs" />

        {tab === 'commands' ? <CommandsPanel /> : <CasesPanel />}
      </div>
    </ControlTowerFrame>
  );
}
