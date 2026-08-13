'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  ContactRound,
  History,
  ShieldCheck,
  Tags,
} from 'lucide-react';
import {
  MetricSurface,
  PageHeader,
  QueryState,
  StatusBadge,
  Timeline,
  type TimelineItem,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { hasPermission } from '@/features/auth/access-control';
import {
  ActorBadge,
  ConsentList,
  CustomerOperationalRelations,
  IdentityList,
  Pagination,
  PrivacyNotice,
} from '@/features/customer-operations/components';
import {
  customerOperationalRelations,
  customerDisplayName,
  humanizeCode,
  interactionActor,
  type TimelineActor,
} from '@/features/customer-operations/model';
import {
  useCustomerProfile,
  useCustomerTimeline,
} from '@/features/customer-operations/queries';
import { useCrmUnifiedTimeline } from '@/features/crm/queries';
import { formatDateTime } from '@/lib/format';

const TIMELINE_PAGE_SIZE = 25;
const actorLegend: TimelineActor[] = ['CUSTOMER', 'SOFIA', 'HUMAN_AGENT', 'SYSTEM_EVENT'];

export default function CustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params?.customerId ?? '';
  const { user } = useAuth();
  const canRead = hasPermission(user?.permissions, 'orders.read');
  const [timelinePage, setTimelinePage] = useState(1);
  const customer = useCustomerProfile(customerId, canRead);
  const timeline = useCustomerTimeline(customerId, { page: timelinePage, limit: TIMELINE_PAGE_SIZE }, canRead);
  const operationalTimeline = useCrmUnifiedTimeline(canRead ? customerId : '');
  const profile = customer.data;
  const operationalRelations = customerOperationalRelations(operationalTimeline.data?.data ?? []);

  const profileStatus = !canRead
    ? 'permission_denied'
    : customer.isPending
      ? 'loading'
      : customer.isError || !profile
        ? 'error'
        : 'ready';

  const timelineStatus = timeline.isPending
    ? 'loading'
    : timeline.isError
      ? 'error'
      : timeline.data?.data.length
        ? 'ready'
        : 'empty';

  const timelineItems: TimelineItem[] =
    timeline.data?.data.map((interaction) => ({
      id: interaction.id,
      title: humanizeCode(interaction.kind),
      timestamp: formatDateTime(interaction.occurredAt),
      description: <p className="whitespace-pre-wrap break-words">{interaction.summary}</p>,
      metadata: (
        <div className="flex flex-wrap items-center gap-2">
          <ActorBadge actor={interactionActor(interaction)} />
          <StatusBadge status={interaction.channel} label={humanizeCode(interaction.channel)} tone="neutral" />
          <span className="text-xs text-muted">{humanizeCode(interaction.direction)}</span>
        </div>
      ),
      tone: interaction.direction === 'INBOUND' ? 'info' : interaction.direction === 'OUTBOUND' ? 'success' : 'neutral',
    })) ?? [];

  return (
    <div className="space-y-6" data-testid="customer-360-page">
      <PageHeader
        eyebrow="Customer 360"
        title={profile ? customerDisplayName(profile.displayName) : 'Perfil de cliente'}
        description={profile ? `Perfil actualizado ${formatDateTime(profile.updatedAt)}. Toda ausencia de datos se declara explícitamente.` : 'Perfil CRM canónico y trazabilidad operacional.'}
        status={profile ? (
          <StatusBadge
            status={profile.status}
            label={profile.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
            tone={profile.status === 'ACTIVE' ? 'success' : 'neutral'}
          />
        ) : undefined}
        actions={
          <Button asChild variant="secondary">
            <Link href="/customers"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al directorio</Link>
          </Button>
        }
      />

      <QueryState
        status={profileStatus}
        title={customer.isError ? 'No se pudo cargar el perfil' : undefined}
        description={customer.isError ? 'El backend no entregó un perfil CRM válido. No se muestran datos estimados.' : undefined}
        onRetry={customer.isError ? () => void customer.refetch() : undefined}
      >
        {profile ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricSurface label="Identidades" value={profile.identities.length.toLocaleString('es-CO')} context="Solo representaciones enmascaradas" icon={<ContactRound className="h-5 w-5" />} />
              <MetricSurface label="Consentimientos" value={profile.consents.length.toLocaleString('es-CO')} context="Historial por canal y propósito" icon={<ShieldCheck className="h-5 w-5" />} />
              <MetricSurface label="Etiquetas" value={profile.tags.length.toLocaleString('es-CO')} context="Clasificación CRM vigente" icon={<Tags className="h-5 w-5" />} />
              <MetricSurface label="Interacciones CRM" value={timeline.data?.pagination.total.toLocaleString('es-CO')} unavailable={!timeline.data} context={timeline.isError ? 'Timeline no disponible' : 'Fuente CRM sanitizada'} icon={<History className="h-5 w-5" />} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,0.75fr)] xl:items-start">
              <div className="space-y-6">
                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="customer-timeline-heading">
                  <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 id="customer-timeline-heading" className="font-heading text-lg font-semibold text-ink">Timeline verificable</h2>
                      <p className="mt-1 text-sm leading-6 text-muted">Interacciones expuestas por el contrato CRM, ordenadas por el backend.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5" aria-label="Actores canónicos del timeline">
                      {actorLegend.map((actor) => <ActorBadge key={actor} actor={actor} />)}
                    </div>
                  </div>
                  <div className="pt-5">
                    <QueryState
                      status={timelineStatus}
                      title={timeline.isError ? 'Timeline no disponible' : 'Sin interacciones registradas'}
                      description={timeline.isError ? 'La fuente CRM falló. No completamos el historial con eventos simulados.' : 'El backend no reporta interacciones para este cliente.'}
                      onRetry={timeline.isError ? () => void timeline.refetch() : undefined}
                    >
                      <Timeline items={timelineItems} label="Timeline del cliente" />
                    </QueryState>
                    {timeline.data ? (
                      <Pagination
                        page={timeline.data.pagination.page}
                        pages={timeline.data.pagination.pages}
                        total={timeline.data.pagination.total}
                        onChange={setTimelinePage}
                        disabled={timeline.isFetching}
                      />
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="related-domains-heading">
                  <h2 id="related-domains-heading" className="font-heading text-lg font-semibold text-ink">Relaciones operativas</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">Read model sanitizado sobre autoridades canónicas. Cada enlace abre el módulo dueño del dato.</p>
                  <div className="mt-4">
                    <QueryState
                      status={operationalTimeline.isPending ? 'loading' : operationalTimeline.isError ? 'error' : 'ready'}
                      title={operationalTimeline.isError ? 'Relaciones operativas no disponibles' : undefined}
                      description={operationalTimeline.isError ? 'No se pudo consultar el read model unificado. No se completan relaciones con datos estimados.' : undefined}
                      onRetry={operationalTimeline.isError ? () => void operationalTimeline.refetch() : undefined}
                    >
                      <CustomerOperationalRelations
                        relations={operationalRelations}
                        potentiallyTruncated={operationalTimeline.data?.readModel.potentiallyTruncated ?? false}
                      />
                    </QueryState>
                  </div>
                </section>
              </div>

              <aside className="space-y-4" aria-label="Datos protegidos del cliente">
                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                  <h2 className="font-heading text-base font-semibold text-ink">Identidades</h2>
                  <p className="mt-1 text-sm text-muted">Representaciones protegidas del perfil canónico.</p>
                  <div className="mt-4"><IdentityList identities={profile.identities} /></div>
                </section>

                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                  <h2 className="font-heading text-base font-semibold text-ink">Consentimiento</h2>
                  <p className="mt-1 text-sm text-muted">Servicio y marketing permanecen separados.</p>
                  <div className="mt-4"><ConsentList consents={profile.consents} /></div>
                </section>

                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                  <h2 className="font-heading text-base font-semibold text-ink">Etiquetas</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {profile.tags.length ? profile.tags.map((tag) => (
                      <span key={tag.id} className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink" title={`Asignada ${formatDateTime(tag.assignedAt)}`}>
                        {tag.name}
                      </span>
                    )) : <p className="text-sm text-muted">Sin etiquetas asignadas.</p>}
                  </div>
                </section>

                <PrivacyNotice>
                  Esta vista no expone teléfonos completos, hashes internos, evidencia de consentimiento ni razonamiento oculto.
                </PrivacyNotice>
              </aside>
            </div>
          </>
        ) : null}
      </QueryState>

      {!profile && !customer.isPending ? (
        <div className="flex justify-center">
          <Button asChild variant="secondary"><Link href="/customers"><ArrowLeft className="h-4 w-4" /> Directorio</Link></Button>
        </div>
      ) : null}

    </div>
  );
}
