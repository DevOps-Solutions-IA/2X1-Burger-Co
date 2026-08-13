'use client';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import type {
  DeliveryLocationSuggestion,
  DeliveryPricingEstimate,
  DeliveryResolvedLocation,
} from './pos.types';

export type DeliveryVisualState = {
  label: string;
  message?: string;
  toneClass: string;
  badgeClass: string;
  statusLabel: string;
};

type PosDeliveryPanelProps = {
  showDeliveryDetails: boolean;
  deliveryVisualState: DeliveryVisualState;
  deliveryPrimaryWarning: string | null;
  deliveryShouldShowFee: boolean;
  deliveryPricingEstimate: DeliveryPricingEstimate | null;
  deliveryFeeValue: number;
  deliveryFinalFeeLabel: string;
  deliveryDistanceLabel: string;
  deliveryEtaLabel: string;
  deliveryZoneDisplay: string;
  deliveryStatus: string;
  deliveryCanCheckout: boolean;
  deliveryIsCalculating: boolean;
  deliveryReference: string;
  deliveryNeighborhood: string;
  deliverySearchQuery: string;
  selectedDeliveryLocation: DeliveryResolvedLocation | null;
  deliveryLocationSuggestions: DeliveryLocationSuggestion[];
  deliveryLocationSearchIsFetching: boolean;
  resolveDeliveryLocationPending: boolean;
  customerName: string;
  customerPhone: string;
  customerLookupFullName?: string | null;
  customerLookupFetched: boolean;
  onRequestDeliveryEstimate: () => void;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
  onCustomerPhoneBlur: () => void;
  onDeliveryReferenceChange: (value: string) => void;
  onDeliveryNeighborhoodChange: (value: string) => void;
  onSelectDeliverySuggestion: (suggestion: DeliveryLocationSuggestion) => void;
};

export function PosDeliveryPanel({
  showDeliveryDetails,
  deliveryVisualState,
  deliveryPrimaryWarning,
  deliveryShouldShowFee,
  deliveryPricingEstimate,
  deliveryFeeValue,
  deliveryFinalFeeLabel,
  deliveryDistanceLabel,
  deliveryEtaLabel,
  deliveryZoneDisplay,
  deliveryStatus,
  deliveryCanCheckout,
  deliveryIsCalculating,
  deliveryReference,
  deliveryNeighborhood,
  deliverySearchQuery,
  selectedDeliveryLocation,
  deliveryLocationSuggestions,
  deliveryLocationSearchIsFetching,
  resolveDeliveryLocationPending,
  customerName,
  customerPhone,
  customerLookupFullName,
  customerLookupFetched,
  onRequestDeliveryEstimate,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onCustomerPhoneBlur,
  onDeliveryReferenceChange,
  onDeliveryNeighborhoodChange,
  onSelectDeliverySuggestion,
}: PosDeliveryPanelProps) {
  return (
    <>
      {showDeliveryDetails ? (
        <div
          className={`relative overflow-hidden rounded-2xl border-l-[5px] bg-white shadow-sm ${deliveryVisualState.toneClass}`}
          data-testid="pos-delivery-panel"
        >
        <div className="p-4">
          <div className="flex items-start justify-between gap-4" data-testid="pos-delivery-result">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-black uppercase tracking-[0.14em] ${deliveryVisualState.badgeClass}`}
                  data-testid="pos-delivery-status-badge"
                >
                  {deliveryVisualState.label}
                </span>
                <span className="sr-only" data-testid="pos-delivery-pricing-status">
                  {deliveryVisualState.statusLabel}
                </span>
                {deliveryShouldShowFee && deliveryPricingEstimate?.suggestedFee != null && deliveryFeeValue !== deliveryPricingEstimate.suggestedFee ? (
                  <span className="text-xs text-stone-600 line-through tabular-nums" data-testid="pos-delivery-suggested-fee">
                    {formatCurrency(deliveryPricingEstimate.suggestedFee)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[13px] font-semibold leading-5 text-stone-600 truncate" data-testid="pos-delivery-message">
                {deliveryVisualState.message}
              </p>
              {deliveryPrimaryWarning ? (
                <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900" data-testid="pos-delivery-warning">
                  {deliveryPrimaryWarning}
                </p>
              ) : (
                <p className="sr-only" data-testid="pos-delivery-warning">Sin advertencias</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-600">Tarifa</p>
              <p
                className={`mt-1 text-[22px] font-black tabular-nums leading-none tracking-tight ${deliveryStatus === 'LOCAL_FREE' ? 'text-emerald-600' : 'text-ink'}`}
                data-testid="pos-delivery-final-fee"
              >
                {deliveryFinalFeeLabel}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <div className="rounded-xl bg-stone-50 px-2.5 py-2 text-center" data-testid="pos-delivery-distance">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-stone-600">{deliveryDistanceLabel}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">km</p>
            </div>
            <div className="rounded-xl bg-stone-50 px-2.5 py-2 text-center" data-testid="pos-delivery-eta">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-ink">{deliveryEtaLabel}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">min</p>
            </div>
            <div className="rounded-xl bg-stone-50 px-2.5 py-2 text-center truncate" data-testid="pos-delivery-coverage">
              <p className="truncate text-xs font-bold text-ink">{deliveryZoneDisplay}</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">zona</p>
            </div>
            <div className="rounded-xl bg-stone-50 px-2.5 py-2 text-center">
              <p className={`text-xs font-bold ${deliveryCanCheckout ? 'text-emerald-800' : 'text-red-700'}`}>
                {deliveryCanCheckout ? 'OK' : 'No'}
              </p>
              <span className="sr-only" data-testid="pos-delivery-can-checkout">
                {deliveryCanCheckout ? 'Habilitado' : 'Checkout bloqueado'}
              </span>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">checkout</p>
            </div>
          </div>
        </div>

        <div className="border-t border-stone-100 px-4 py-2.5 flex items-center justify-between gap-3" data-testid="pos-delivery-estimate-button">
          <span
            className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-600"
            data-testid="pos-delivery-calculating"
          >
            {deliveryIsCalculating ? 'Calculando...' : deliveryPricingEstimate ? 'Ultima estimacion' : 'Sin estimar'}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-lg border-stone-200 bg-white text-xs font-bold text-stone-700 hover:bg-stone-100"
            onClick={onRequestDeliveryEstimate}
            disabled={deliveryIsCalculating || !deliveryReference.trim()}
            data-testid="pos-delivery-recalculate"
          >
            {deliveryIsCalculating ? '...' : 'Calcular domicilio'}
          </Button>
        </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Cliente">
            <Input
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={customerName}
              onChange={(event) => onCustomerNameChange(event.target.value)}
              data-testid="pos-delivery-customer-name"
            />
          </Field>
        </div>
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Teléfono" hint={customerLookupFullName ? 'Cliente encontrado' : undefined}>
            <Input
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={customerPhone}
              onChange={(event) => onCustomerPhoneChange(event.target.value)}
              onBlur={onCustomerPhoneBlur}
              data-testid="pos-delivery-phone"
            />
          </Field>
          {customerLookupFullName ? (
            <p className="mt-1 text-xs font-medium text-emerald-800">✓ {customerLookupFullName}</p>
          ) : customerLookupFetched && customerPhone.length >= 10 ? (
            <p className="mt-1 text-xs text-stone-600">Cliente nuevo — se guardará al abrir el pedido</p>
          ) : null}
        </div>
      </div>

      {showDeliveryDetails ? (
        <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.25rem] border border-stone-200 bg-white p-4 md:col-span-2">
          <Field label="Dirección del cliente" hint="Ej: Carrera 22 #10-15, barrio Condados." required>
            <Input
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={deliveryReference}
              onChange={(event) => onDeliveryReferenceChange(event.target.value)}
              data-testid="pos-delivery-reference"
            />
          </Field>
          <div className="mt-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-3" data-testid="pos-delivery-google-search">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-600">
                Dirección sugerida
              </p>
              <span className="text-xs font-semibold text-stone-600">
                {deliveryLocationSearchIsFetching ? 'Buscando...' : selectedDeliveryLocation ? 'Seleccionada' : 'Google'}
              </span>
            </div>
            {selectedDeliveryLocation?.formattedAddress ? (
              <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2" data-testid="pos-delivery-place-selected">
                <p className="text-[12px] font-bold text-emerald-900">{selectedDeliveryLocation.formattedAddress}</p>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
                  Ubicación confiable
                </p>
              </div>
            ) : deliveryLocationSuggestions.length ? (
              <div className="mt-2 grid gap-2" data-testid="pos-delivery-suggestions">
                {deliveryLocationSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50"
                    onClick={() => onSelectDeliverySuggestion(suggestion)}
                    disabled={resolveDeliveryLocationPending}
                    data-testid="pos-delivery-suggestion"
                  >
                    <span className="block text-[12px] font-bold text-ink">{suggestion.mainText}</span>
                    <span className="block text-xs font-semibold text-stone-600">{suggestion.secondaryText}</span>
                  </button>
                ))}
              </div>
            ) : deliverySearchQuery.length >= 3 && !deliveryLocationSearchIsFetching ? (
              <p className="mt-2 text-xs font-semibold text-stone-600" data-testid="pos-delivery-no-suggestions">
                Sin sugerencias. Agrega ciudad, barrio o punto de referencia.
              </p>
            ) : (
              <p className="mt-2 text-xs font-semibold text-stone-600">
                Escribe al menos 3 caracteres para buscar una dirección.
              </p>
            )}
          </div>
        </div>
        <div className="rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Barrio o sector">
            <Input
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={deliveryNeighborhood}
              onChange={(event) => onDeliveryNeighborhoodChange(event.target.value)}
              placeholder="Ej: Alborada, Condados"
              data-testid="pos-delivery-neighborhood"
            />
          </Field>
        </div>
        <div className="sr-only" data-testid="pos-delivery-address">{deliveryReference}</div>
        </div>
      ) : null}
    </>
  );
}
