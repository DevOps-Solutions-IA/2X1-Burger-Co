'use client';

import { useState } from 'react';
import { Filter, Megaphone, Send, ShieldBan } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBanner } from '@/components/ui/status-banner';
import { QueryStateBoundary, StatCard, Pager } from '@/components/sofia';
import { useSofiaCrmCampaigns, useSofiaCrmSegments } from '@/features/sofia/queries';
import { CreateCampaignForm } from './CreateCampaignForm';
import { CampaignCard } from './CampaignCard';

const PAGE_SIZE = 10;

export function CampaignsView() {
  const [page, setPage] = useState(1);
  const [segmentId, setSegmentId] = useState('');

  const segments = useSofiaCrmSegments(1, 100);
  const campaigns = useSofiaCrmCampaigns({ page, limit: PAGE_SIZE, segmentId: segmentId || undefined });

  const pageItems = campaigns.data?.data ?? [];
  const deliveriesOnPage = pageItems.reduce((sum, campaign) => sum + campaign._count.deliveries, 0);
  const blockedOnPage = pageItems.filter((campaign) => campaign.status === 'BLOCKED').length;

  return (
    <div className="space-y-5" data-testid="sofia-crm-campaigns-view">
      <StatusBanner
        tone="danger"
        title="El envío real de WhatsApp está siempre bloqueado por diseño"
        description="Es una invariante de seguridad verificada del sistema, no un límite temporal ni configurable. El botón «Intentar enviar» demuestra el flujo real de principio a fin y queda registrado como evidencia de auditoría, pero SOFIA nunca despacha un mensaje real desde una campaña."
        data-testid="sofia-crm-campaigns-global-block-notice"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Campañas totales"
          value={String(campaigns.data?.pagination.total ?? 0)}
          icon={<Megaphone className="h-4.5 w-4.5" />}
          accent="brand"
          data-testid="sofia-crm-campaigns-stat-total"
        />
        <StatCard
          label="Entregas en esta página"
          value={String(deliveriesOnPage)}
          hint="Suma de entregas de las campañas visibles"
          icon={<Send className="h-4.5 w-4.5" />}
          accent="ink"
          data-testid="sofia-crm-campaigns-stat-deliveries"
        />
        <StatCard
          label="Bloqueadas en esta página"
          value={String(blockedOnPage)}
          hint="Campañas con al menos un intento registrado"
          icon={<ShieldBan className="h-4.5 w-4.5" />}
          accent="danger"
          data-testid="sofia-crm-campaigns-stat-blocked"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <Card data-testid="sofia-crm-campaigns-filters">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filtros
            </div>
            <div className="mt-2.5 max-w-xs">
              <Field label="Segmento">
                <Select
                  value={segmentId}
                  onChange={(event) => {
                    setSegmentId(event.target.value);
                    setPage(1);
                  }}
                  data-testid="sofia-crm-campaigns-filter-segment"
                >
                  <option value="">Todos los segmentos</option>
                  {segments.data?.data.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <QueryStateBoundary
            isLoading={campaigns.isLoading}
            isError={campaigns.isError}
            error={campaigns.error}
            data={campaigns.data}
            loadingLabel="Cargando campañas…"
            errorTitle="No se pudieron cargar las campañas"
            data-testid="sofia-crm-campaigns-list"
          >
            {(data) =>
              data.data.length === 0 ? (
                <EmptyState
                  icon={<Megaphone className="h-5 w-5" />}
                  title="Sin campañas"
                  description="Todavía no hay campañas registradas para este filtro. Crea la primera desde el formulario."
                  data-testid="sofia-crm-campaigns-empty"
                />
              ) : (
                <div className="space-y-3" data-testid="sofia-crm-campaigns-cards">
                  {data.data.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}

                  <Pager
                    page={data.pagination.page}
                    limit={data.pagination.limit}
                    total={data.pagination.total}
                    pages={data.pagination.pages}
                    itemsLabel="campaña(s)"
                    onPrev={() => setPage((prev) => Math.max(prev - 1, 1))}
                    onNext={() => setPage((prev) => prev + 1)}
                    data-testid="sofia-crm-campaigns-pagination"
                  />
                </div>
              )
            }
          </QueryStateBoundary>
        </div>

        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-4">
            <CreateCampaignForm onCreated={() => setPage(1)} />
          </div>
        </div>
      </div>
    </div>
  );
}
