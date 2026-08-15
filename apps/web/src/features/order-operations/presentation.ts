import type {
  CheckoutSummary,
  KitchenOrder,
  OrderStatus,
  OrderType,
  PaymentIntentStatus,
} from './contracts';

export const orderStatusLabels: Record<OrderStatus, string> = {
  OPEN: 'Abierta',
  IN_PREPARATION: 'En preparación',
  SERVED: 'Lista / servida',
  PAYMENT_PENDING: 'Pago pendiente',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
};

export const orderTypeLabels: Record<OrderType, string> = {
  DINE_IN: 'Mesa',
  TAKEAWAY: 'Para llevar',
  DELIVERY: 'Domicilio',
  COUNTER: 'Mostrador',
};

export const paymentStatusLabels: Record<PaymentIntentStatus, string> = {
  CREATED: 'Intento creado',
  LINK_READY: 'Pago en línea listo',
  PENDING: 'Pago pendiente',
  SUCCEEDED: 'Pago verificado',
  FAILED: 'Pago fallido',
  EXPIRED: 'Pago expirado',
  CANCELLED: 'Pago cancelado',
  UNKNOWN_RESULT: 'Resultado financiero desconocido',
  FINANCIAL_REVIEW_REQUIRED: 'Revisión financiera requerida',
};

export function currentPaymentStatus(checkout: CheckoutSummary) {
  if (checkout?.status === 'FINANCIAL_REVIEW_REQUIRED') return 'FINANCIAL_REVIEW_REQUIRED';
  return checkout?.paymentIntents[0]?.status ?? null;
}

export function paymentSummary(checkout: CheckoutSummary) {
  if (!checkout) return { label: 'Sin checkout asociado', status: 'UNAVAILABLE' };
  const intentStatus = currentPaymentStatus(checkout);
  if (!intentStatus) {
    return {
      label: checkout.paymentPreference.replaceAll('_', ' '),
      status: checkout.status,
    };
  }
  return { label: paymentStatusLabels[intentStatus], status: intentStatus };
}

export function orderTotal(subtotal: number | string, deliveryFee: number | string) {
  return Number(subtotal) + Number(deliveryFee);
}

export function elapsedLabel(openedAt: string, now = Date.now()) {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
}

function modifierValue(modifier: Record<string, unknown>, key: string) {
  const value = modifier[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function modifierLabel(modifier: KitchenOrder['items'][number]['modifiersSnapshot'][number]) {
  const kind = modifierValue(modifier, 'kind');
  const subject =
    modifierValue(modifier, 'ingredient') ??
    modifierValue(modifier, 'name') ??
    modifierValue(modifier, 'label') ??
    modifierValue(modifier, 'optionName');
  if (!kind && !subject) return 'Modificación registrada';
  if (!kind) return subject ?? 'Modificación registrada';
  if (!subject) return kind.replaceAll('_', ' ');
  const action = kind === 'REMOVE' ? 'Sin' : kind === 'ADD' ? 'Agregar' : kind.replaceAll('_', ' ');
  return `${action} ${subject}`;
}
