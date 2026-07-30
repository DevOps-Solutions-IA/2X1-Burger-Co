'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ContactRound,
  History,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Tag,
  XCircle,
} from 'lucide-react';
import {
  SofiaEmptyState,
  SofiaPageHero,
  SofiaPageShell,
  SofiaSectionCard,
  SofiaStatusPill,
} from '@/components/sofia';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  SofiaCrmCustomerConsent,
  SofiaCrmCustomerInteraction,
} from '@/features/sofia/contracts';
import {
  useSofiaCrmCustomer,
  useSofiaCrmCustomerTimeline,
} from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';
import {
  CrmErrorState,
  PaginationControls,
  customerDisplayName,
  humanizeCrmCode,
} from '../_components/crm-ui';

const TIMELINE_PAGE_SIZE = 25;

const channelLabels: Record<SofiaCrmCustomerInteraction['channel'], string> = {
  WHATSAPP: 'WhatsApp',
  PHONE: 'Teléfono',
  IN_PERSON: 'Presencial',
  SYSTEM: 'Sistema',
};

const directionLabels: Record<SofiaCrmCustomerInteraction['direction'], string> = {
  INBOUND: 'Entrada',
  OUTBOUND: 'Salida registrada',
  INTERNAL: 'Nota interna',
};

function DetailLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando perfil CRM">
      <span className="sr-only">Cargando perfil CRM.</span>
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Skeleton className="h-[32rem] w-full" />
        <div className="space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

function ConsentRecord({ consent }: { consent: SofiaCrmCustomerConsent }) {
  const isGranted = consent.status === 'GRANTED';
  const purpose = consent.purpose === 'MARKETING' ? 'Marketing' : 'Servicio';
  const channel = consent.channel === 'WHATSAPP' ? 'WhatsApp' : humanizeCrmCode(consent.channel);

  return (
    <li className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={
              isGranted
                ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700'
                : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-200 text-stone-600'
            }
          >
            {isGranted ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="text-sm font-extrabold text-stone-900">{purpose} · {channel}</p>
            <p className="mt-1 text-xs font-semibold text-stone-500">
              Fuente: {consent.source} · Versión {consent.version}
            </p>
          </div>
        </div>
        <SofiaStatusPill
          status={isGranted ? 'PASS' : 'NEUTRAL'}
          label={isGranted ? 'Otorgado' : 'Revocado'}
        />
      </div>
      <p className="mt-3 text-xs font-semibold text-stone-500">
        Registrado {formatDateTime(consent.createdAt)}
      </p>
    </li>
  );
}

function TimelineItem({
  interaction,
  isLast,
}: {
  interaction: SofiaCrmCustomerInteraction;
  isLast: boolean;
}) {
  const DirectionIcon =
    interaction.direction === 'INBOUND'
      ? ArrowDownLeft
      : interaction.direction === 'OUTBOUND'
        ? ArrowUpRight
        : MessageSquareText;

  return (
    <li className="relative pl-12">
      {!isLast ? (
        <span
          className="absolute left-[1.125rem] top-10 h-[calc(100%+0.75rem)] w-px bg-stone-200"
          aria-hidden="true"
        />
      ) : null}
      <span className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-xl border border-sofia-100 bg-sofia-50 text-sofia-700">
        <DirectionIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-stone-950">{humanizeCrmCode(interaction.kind)}</h3>
            <p className="mt-1 text-xs font-semibold text-stone-500">
              {channelLabels[interaction.channel]} · {directionLabels[interaction.direction]}
            </p>
          </div>
          <time
            className="shrink-0 text-xs font-semibold tabular-nums text-stone-500"
            dateTime={interaction.occurredAt}
          >
            {formatDateTime(interaction.occurredAt)}
          </time>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-stone-700">
          {interaction.summary}
        </p>
      </article>
    </li>
  );
}

export default function SofiaCustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params?.customerId ?? '';
  const [timelinePage, setTimelinePage] = useState(1);
  const customer = useSofiaCrmCustomer(customerId);
  const timeline = useSofiaCrmCustomerTimeline(customerId, {
    page: timelinePage,
    limit: TIMELINE_PAGE_SIZE,
  });

  if (customer.isPending) {
    return <SofiaPageShell data-testid="sofia-customer-detail-page"><DetailLoading /></SofiaPageShell>;
  }

  if (customer.isError || !customer.data) {
    return (
      <SofiaPageShell data-testid="sofia-customer-detail-page">
        <CrmErrorState
          title="No se pudo cargar el perfil CRM"
          description={
            customer.error instanceof Error
              ? customer.error.message
              : 'El perfil no existe o el backend no devolvió un contrato CRM válido.'
          }
          onRetry={() => void customer.refetch()}
          className="min-h-[55vh]"
        />
        <div className="flex justify-center">
          <Button asChild variant="secondary">
            <Link href="/sofia/customers">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Volver a clientes
            </Link>
          </Button>
        </div>
      </SofiaPageShell>
    );
  }

  const profile = customer.data;

  return (
    <SofiaPageShell data-testid="sofia-customer-detail-page">
      <SofiaPageHero
        eyebrow="Perfil CRM canónico"
        title={customerDisplayName(profile.displayName)}
        description={`Perfil actualizado ${formatDateTime(profile.updatedAt)}. Datos operativos de solo lectura.`}
        statusChips={
          <>
            <SofiaStatusPill
              status={profile.status === 'ACTIVE' ? 'PASS' : 'NEUTRAL'}
              label={profile.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
            />
            <SofiaStatusPill status="INFO" label="Identidades enmascaradas" />
          </>
        }
        actions={
          <Link
            href="/sofia/customers"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver a clientes
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)] lg:items-start">
        <div className="order-2 lg:order-1">
          <SofiaSectionCard
            eyebrow="Historial verificable"
            title="Timeline"
            description="Interacciones registradas por el backend, ordenadas desde la más reciente."
            icon={<History className="h-4 w-4" aria-hidden="true" />}
            actions={
              timeline.isFetching && !timeline.isPending ? (
                <span className="text-xs font-bold text-sofia-700" role="status">Actualizando…</span>
              ) : null
            }
          >
            {timeline.isPending ? (
              <div className="space-y-4" role="status" aria-label="Cargando timeline">
                <span className="sr-only">Cargando timeline.</span>
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-32 w-full" />
                ))}
              </div>
            ) : null}

            {timeline.isError ? (
              <CrmErrorState
                title="No se pudo cargar el timeline"
                description={
                  timeline.error instanceof Error
                    ? timeline.error.message
                    : 'El backend no devolvió un timeline CRM válido.'
                }
                onRetry={() => void timeline.refetch()}
              />
            ) : null}

            {!timeline.isError && timeline.data?.data.length === 0 ? (
              <SofiaEmptyState
                icon={CalendarClock}
                title="Sin interacciones registradas"
                description="El backend no reporta eventos para este cliente. No se completa el historial con datos simulados."
              />
            ) : null}

            {!timeline.isError && timeline.data && timeline.data.data.length > 0 ? (
              <>
                <ol className="space-y-5">
                  {timeline.data.data.map((interaction, index) => (
                    <TimelineItem
                      key={interaction.id}
                      interaction={interaction}
                      isLast={index === timeline.data.data.length - 1}
                    />
                  ))}
                </ol>
                <div className="mt-6">
                  <PaginationControls
                    page={timeline.data.pagination.page}
                    pages={timeline.data.pagination.pages}
                    total={timeline.data.pagination.total}
                    onPageChange={setTimelinePage}
                    disabled={timeline.isFetching}
                    itemLabel="interacciones"
                  />
                </div>
              </>
            ) : null}
          </SofiaSectionCard>
        </div>

        <aside className="order-1 space-y-6 lg:order-2" aria-label="Resumen del cliente">
          <SofiaSectionCard
            eyebrow="Privacidad"
            title="Identidades"
            description="Solo se muestran representaciones protegidas."
            icon={<LockKeyhole className="h-4 w-4" aria-hidden="true" />}
          >
            {profile.identities.length > 0 ? (
              <ul className="space-y-3">
                {profile.identities.map((identity) => (
                  <li key={identity.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-stone-500">
                          Teléfono {identity.isPrimary ? 'principal' : 'alterno'}
                        </p>
                        <p className="mt-2 font-mono text-base font-extrabold tabular-nums text-stone-950">
                          {identity.valueMasked}
                        </p>
                      </div>
                      <SofiaStatusPill
                        status={identity.verifiedAt ? 'PASS' : 'NEUTRAL'}
                        label={identity.verifiedAt ? 'Verificada' : 'No verificada'}
                        className="px-2.5"
                      />
                    </div>
                    {identity.verifiedAt ? (
                      <p className="mt-2 text-xs font-semibold text-stone-500">
                        Verificada {formatDateTime(identity.verifiedAt)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm font-semibold text-stone-500">Sin identidades registradas.</p>
            )}
          </SofiaSectionCard>

          <SofiaSectionCard
            eyebrow="Clasificación"
            title="Tags"
            description="Etiquetas asignadas al perfil canónico."
            icon={<Tag className="h-4 w-4" aria-hidden="true" />}
          >
            {profile.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {profile.tags.map((tag) => (
                  <li key={tag.id}>
                    <span
                      className="inline-flex rounded-full border border-sofia-100 bg-sofia-50 px-3 py-1.5 text-xs font-extrabold text-sofia-800"
                      title={`Asignado ${formatDateTime(tag.assignedAt)}`}
                    >
                      {tag.name}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-stone-200 p-4 text-stone-500">
                <Tag className="h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-sm font-semibold">Sin tags asignados.</p>
              </div>
            )}
          </SofiaSectionCard>

          <SofiaSectionCard
            eyebrow="Auditabilidad"
            title="Consentimientos"
            description="Historial de estados registrado por canal y propósito."
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          >
            {profile.consents.length > 0 ? (
              <ul className="space-y-3">
                {profile.consents.map((consent) => (
                  <ConsentRecord key={consent.id} consent={consent} />
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-stone-200 p-4 text-stone-500">
                <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-sm font-semibold">Sin consentimientos registrados.</p>
              </div>
            )}
          </SofiaSectionCard>

          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-900">
            <div className="flex items-start gap-3">
              <ContactRound className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
              <p className="text-xs font-semibold leading-5">
                Perfil de consulta. Esta vista no modifica consentimientos ni ejecuta acciones sobre el cliente.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </SofiaPageShell>
  );
}
