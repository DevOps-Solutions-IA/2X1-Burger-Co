'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CrmFrame, PageHeader } from '@/components/sofia';
import { Button } from '@/components/ui/button';
import { CreateSegmentForm } from '@/features/sofia/crm/segments/CreateSegmentForm';
import { SegmentsListView } from '@/features/sofia/crm/segments/SegmentsListView';

export default function SofiaCrmSegmentsPage() {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-segments-page">
        <PageHeader
          eyebrow="CRM"
          title="Segmentos"
          description="Segmentos de clientes del CRM, con su membresía y campañas asociadas. El envío real de campañas permanece bloqueado por diseño."
          actions={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setIsCreating((current) => !current)}
              data-testid="sofia-crm-segments-new-toggle"
            >
              <Plus className="h-4 w-4" />
              Nuevo segmento
            </Button>
          }
          data-testid="sofia-crm-segments-header"
        />

        {isCreating && <CreateSegmentForm onClose={() => setIsCreating(false)} />}

        <SegmentsListView />
      </div>
    </CrmFrame>
  );
}
