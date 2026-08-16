'use client';

import { useState } from 'react';
import { Megaphone, ShieldBan } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary } from '@/components/sofia';
import { useSofiaCrmCampaigns, useSofiaCrmSegments } from '@/features/sofia/queries';
import { CreateCampaignForm } from './CreateCampaignForm';
import { CampaignCard } from './CampaignCard';

const PAGE_SIZE = 10;

export function CampaignsView() {
  const [page, setPage] = useState(1);
  const [segmentId, setSegmentId] = useState('');

  const segments = useSofiaCrmSegments(1, 100);
  const campaigns = useSofiaCrmCampaigns({ page, limit: PAGE_SIZE, segmentId: segmentId || undefined });

  return (
    <div className="space-y-4" data-testid="sofia-crm-campaigns-view">
      <div
        className="flex items-start gap-2 rounded-[1.35rem] border border-red-200 bg-red-50 px-4 py-3.5 text-[12.5px] leading-5.5 text-red-800"
        data-testid="sofia-crm-campaigns-global-block-notice"
      >
        <ShieldBan className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Todo intento de envío de campaña queda <strong>siempre bloqueado por diseño</strong>. Es una invariante de seguridad del
          sistema, no un límite temporal: SOFIA nunca envía WhatsApp real desde una campaña. Cada intento se registra para auditoría.
        </p>
      </div>

      <CreateCampaignForm onCreated={() => setPage(1)} />

      <Card data-testid="sofia-crm-campaigns-filters">
        <div className="max-w-xs">
          <Field label="Filtrar por segmento">
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
              description="Todavía no hay campañas registradas para este filtro. Crea una arriba."
              data-testid="sofia-crm-campaigns-empty"
            />
          ) : (
            <div className="space-y-3" data-testid="sofia-crm-campaigns-cards">
              {data.data.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}

              <div className="flex items-center justify-between pt-1" data-testid="sofia-crm-campaigns-pagination">
                <p className="text-[11.5px] text-stone-500">
                  Página {data.pagination.page} de {Math.max(data.pagination.pages, 1)} · {data.pagination.total} campaña(s)
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                    data-testid="sofia-crm-campaigns-page-prev"
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page >= data.pagination.pages}
                    onClick={() => setPage((prev) => prev + 1)}
                    data-testid="sofia-crm-campaigns-page-next"
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
