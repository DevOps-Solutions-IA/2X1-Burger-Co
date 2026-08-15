'use client';

import Link from 'next/link';
import { ArrowUpRight, MessageCircle, ShieldAlert, Store, Truck } from 'lucide-react';
import { useSofiaDashboardSummary } from '@/features/sofia/queries';
import { OverviewSecurityPanel } from '@/features/sofia/overview/OverviewSecurityPanel';
import { OverviewWhatsappPanel } from '@/features/sofia/overview/OverviewWhatsappPanel';
import { OverviewAiPanel } from '@/features/sofia/overview/OverviewAiPanel';
import { OverviewSafetyGuardPanel } from '@/features/sofia/overview/OverviewSafetyGuardPanel';
import { OverviewGovernancePanel } from '@/features/sofia/overview/OverviewGovernancePanel';
import { Button } from '@/components/ui/button';
import {
  MetricTile,
  OperatorWorkspaceFrame,
  QueryStateBoundary,
  StatusBadge,
  WorkspaceHeader,
} from '@/components/sofia/workspace';

export default function SofiaOverviewPage() {
  const summary = useSofiaDashboardSummary();

  return (
    <OperatorWorkspaceFrame>
      <QueryStateBoundary
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        data={summary.data}
        loadingLabel="Cargando resumen operativo de Sofía…"
        errorTitle="No se pudo cargar el resumen operativo"
        data-testid="sofia-overview"
      >
        {(data) => (
          <div className="space-y-4" data-testid="sofia-overview-page">
            <WorkspaceHeader
              eyebrow="Centro de gobierno Sofía"
              title="Resumen operativo"
              description="Sofía analiza mensajes, genera sugerencias y protege la operación. Los pedidos reales siguen en POS y Domicilios."
              statusBadges={
                <>
                  <StatusBadge tone={data.general.productionBlocked ? 'blocked' : 'warning'} label={data.general.productionBlocked ? 'Producción bloqueada' : 'Producción activa'} />
                  <StatusBadge tone="read_only" label="Receive-only" />
                  <StatusBadge tone={data.general.autoReplyEnabled ? 'warning' : 'blocked'} label={data.general.autoReplyEnabled ? 'Auto reply activo' : 'Auto reply OFF'} />
                  <StatusBadge tone={data.general.globalPaused ? 'blocked' : 'success'} label={data.general.globalPaused ? 'Sofía pausada' : 'Sofía activa'} />
                </>
              }
              actions={
                <>
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={data.routes.conversationsUrl}>
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Conversaciones
                    </Link>
                  </Button>
                  {data.routes.whatsappQrUrl && (
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={data.routes.whatsappQrUrl}>
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        WhatsApp QR
                      </Link>
                    </Button>
                  )}
                </>
              }
              data-testid="sofia-overview-hero"
            />

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="sofia-overview-metrics">
              <MetricTile
                label="Conversaciones"
                value={data.conversations.totalConversations}
                detail={`${data.conversations.realConversations} reales`}
                tone="sofia"
              />
              <MetricTile
                label="Requieren humano"
                value={data.conversations.humanRequired}
                detail="Revisión de operador"
                tone={data.conversations.humanRequired > 0 ? 'warning' : 'neutral'}
              />
              <MetricTile
                label="Pago sensible"
                value={data.conversations.paymentSensitive}
                detail="WhatsApp no marca PAID"
                tone={data.conversations.paymentSensitive > 0 ? 'danger' : 'neutral'}
              />
              <MetricTile
                label="Pendiente de revisión"
                value={data.conversations.pendingReview}
                detail="Sin resolver todavía"
                tone={data.conversations.pendingReview > 0 ? 'warning' : 'success'}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3" data-testid="sofia-overview-panels">
              <OverviewWhatsappPanel whatsappQr={data.whatsappQr} />
              <OverviewAiPanel ai={data.ai} />
              <OverviewSecurityPanel security={data.security} />
            </section>

            <OverviewSafetyGuardPanel safetyGuard={data.safetyGuard} />

            <OverviewGovernancePanel />

            <section className="grid gap-3 sm:grid-cols-2" data-testid="sofia-overview-quicklinks">
              <Link
                href={data.routes.deliveriesUrl}
                className="group flex items-center justify-between rounded-[1.15rem] border border-stone-200 bg-white p-3.5 text-[13px] font-semibold text-stone-700 transition-colors hover:border-brand-200"
              >
                <span className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-stone-400" aria-hidden="true" />
                  Ver domicilios
                </span>
                <ArrowUpRight className="h-4 w-4 text-stone-400 group-hover:text-brand-600" aria-hidden="true" />
              </Link>
              <Link
                href={data.routes.posUrl}
                className="group flex items-center justify-between rounded-[1.15rem] border border-stone-200 bg-white p-3.5 text-[13px] font-semibold text-stone-700 transition-colors hover:border-brand-200"
              >
                <span className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-stone-400" aria-hidden="true" />
                  Ver punto de venta
                </span>
                <ArrowUpRight className="h-4 w-4 text-stone-400 group-hover:text-brand-600" aria-hidden="true" />
              </Link>
            </section>
          </div>
        )}
      </QueryStateBoundary>
    </OperatorWorkspaceFrame>
  );
}
