'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CaseDetailView } from '@/features/sofia/customer-service/CaseDetailView';
import { OperatorWorkspaceFrame, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaCustomerServiceCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params?.caseId ?? '';

  return (
    <OperatorWorkspaceFrame>
      <div className="space-y-4" data-testid="sofia-customer-service-case-page">
        <Link
          href="/sofia/customer-service"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
          data-testid="sofia-customer-service-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Volver a casos
        </Link>

        <WorkspaceHeader
          eyebrow="Servicio al cliente"
          title="Detalle del caso"
          description="Historial de auditoría del caso y control de transición operado por el humano."
        />

        <CaseDetailView caseId={caseId} />
      </div>
    </OperatorWorkspaceFrame>
  );
}
