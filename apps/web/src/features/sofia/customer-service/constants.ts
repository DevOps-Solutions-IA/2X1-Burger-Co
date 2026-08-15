import type { SofiaStatusTone } from '@/components/sofia/workspace';
import type { SofiaCustomerServiceCaseSummary } from '@/features/sofia/contracts';
import { humanizeCrmCode } from '@/features/sofia/crm-display';

export type CustomerServiceCaseStatus = SofiaCustomerServiceCaseSummary['status'];

/**
 * Máquina de estados real y lineal del backend (customer-service-case.service.ts):
 * cada estado solo puede avanzar al siguiente de esta lista, nunca saltar ni retroceder.
 */
export const CUSTOMER_SERVICE_STATUS_SEQUENCE: readonly CustomerServiceCaseStatus[] = [
  'OPEN',
  'HUMAN_REQUIRED',
  'HUMAN_TAKEN',
  'RESOLVED',
  'CLOSED',
];

export const CUSTOMER_SERVICE_CASE_CATEGORIES = [
  'LATE_ORDER',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'COLD_FOOD',
  'QUALITY',
  'PAYMENT_PROBLEM',
  'DELIVERY_PROBLEM',
  'OTHER',
] as const;

export const CUSTOMER_SERVICE_STATUS_LABEL: Record<CustomerServiceCaseStatus, string> = {
  OPEN: 'Abierto',
  HUMAN_REQUIRED: 'Requiere humano',
  HUMAN_TAKEN: 'Tomado por humano',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

export const CUSTOMER_SERVICE_STATUS_TONE: Record<CustomerServiceCaseStatus, SofiaStatusTone> = {
  OPEN: 'pending',
  HUMAN_REQUIRED: 'human_required',
  HUMAN_TAKEN: 'warning',
  RESOLVED: 'success',
  CLOSED: 'read_only',
};

function isCustomerServiceCaseStatus(value: string): value is CustomerServiceCaseStatus {
  return (CUSTOMER_SERVICE_STATUS_SEQUENCE as readonly string[]).includes(value);
}

/** Siguiente estado válido según la máquina de estados lineal del backend, o null si no hay transición disponible. */
export function nextCustomerServiceStatus(status: CustomerServiceCaseStatus): CustomerServiceCaseStatus | null {
  const index = CUSTOMER_SERVICE_STATUS_SEQUENCE.indexOf(status);
  if (index === -1 || index === CUSTOMER_SERVICE_STATUS_SEQUENCE.length - 1) return null;
  return CUSTOMER_SERVICE_STATUS_SEQUENCE[index + 1] ?? null;
}

/** Etiqueta legible para un status conocido; cae a un formato genérico si el backend expone un valor inesperado. */
export function customerServiceStatusLabel(value: string): string {
  return isCustomerServiceCaseStatus(value) ? CUSTOMER_SERVICE_STATUS_LABEL[value] : humanizeCrmCode(value);
}

/** Tono visual para un status conocido; cae a 'read_only' si el backend expone un valor inesperado. */
export function customerServiceStatusTone(value: string): SofiaStatusTone {
  return isCustomerServiceCaseStatus(value) ? CUSTOMER_SERVICE_STATUS_TONE[value] : 'read_only';
}
