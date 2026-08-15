'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { quickOrderNotes, toggleNoteSnippet } from './pos.helpers';
import type { DiningTable, OrderStatus, OrderType } from './pos.types';

type PosOrderMetadataPanelProps = {
  orderType: OrderType;
  orderStatus: OrderStatus;
  selectedTableId: string;
  availableTables: DiningTable[];
  orderNotes: string;
  deliverySlot: ReactNode;
  onOrderTypeChange: (value: OrderType) => void;
  onOrderStatusChange: (value: OrderStatus) => void;
  onSelectedTableChange: (value: string) => void;
  onOrderNotesChange: Dispatch<SetStateAction<string>>;
};

export function PosOrderMetadataPanel({
  orderType,
  orderStatus,
  selectedTableId,
  availableTables,
  orderNotes,
  deliverySlot,
  onOrderTypeChange,
  onOrderStatusChange,
  onSelectedTableChange,
  onOrderNotesChange,
}: PosOrderMetadataPanelProps) {
  return (
    <div className="mt-6 space-y-5 rounded-[1.6rem] border border-stone-200 bg-stone-50/80 p-5" data-testid="pos-order-metadata-panel">
      <div className="border-b border-stone-200 pb-4">
        <p className="font-semibold text-ink">Datos de la comanda</p>
        <p className="mt-1 text-[13px] leading-6 text-stone-500">
          Define la atención, el cliente y los detalles del pedido antes de abrir o actualizar la comanda.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Tipo de atención" required>
            <Select
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={orderType}
              onChange={(event) => onOrderTypeChange(event.target.value as OrderType)}
              data-testid="pos-delivery-mode"
            >
              <option value="TAKEAWAY">Mostrador</option>
              <option value="DINE_IN">Mesa</option>
              <option value="DELIVERY">Domicilio</option>
              <option value="COUNTER">Venta directa</option>
            </Select>
          </Field>
        </div>
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Estado de la comanda" required>
            <Select
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={orderStatus}
              onChange={(event) => onOrderStatusChange(event.target.value as OrderStatus)}
            >
              <option value="OPEN">Abierta</option>
              <option value="IN_PREPARATION">En preparación</option>
              <option value="SERVED">Servida</option>
              <option value="PAYMENT_PENDING">Pago pendiente</option>
            </Select>
          </Field>
        </div>
      </div>
      {orderType === 'DINE_IN' ? (
        <div className="rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Mesa asignada" required>
            <Select
              className="h-11 rounded-2xl border-stone-300 bg-stone-50 px-4"
              value={selectedTableId}
              onChange={(event) => onSelectedTableChange(event.target.value)}
              data-testid="order-table-select"
            >
              <option value="">Selecciona una mesa</option>
              {availableTables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.area ? `${table.label} · ${table.area}` : table.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {deliverySlot}
      <div className="grid grid-cols-1 gap-4">
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4">
          <Field label="Notas internas" hint="Opcional. Útil para detalles de cocina o servicio.">
            <Textarea
              className="min-h-[108px]"
              value={orderNotes}
              onChange={(event) => onOrderNotesChange(event.target.value)}
            />
          </Field>
        </div>
        <div className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white px-4 py-3.5" data-testid="pos-quick-notes-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
            Accesos directos
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickOrderNotes.map((snippet) => {
              const isActive = orderNotes
                .split(/[\n,]+/)
                .map((line) => line.trim())
                .includes(snippet);
              return (
                <button
                  key={snippet}
                  type="button"
                  className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${isActive ? 'border-brand-300 bg-brand-50 text-brand-900' : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:text-brand-900'}`}
                  onClick={() => onOrderNotesChange((current) => toggleNoteSnippet(current, snippet))}
                >
                  {snippet}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
