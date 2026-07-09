import type { CartItem, OrderStatus, OrderType, PaymentRow, SaleChannel } from './pos.types';

export const orderStatusLabels: Record<OrderStatus, string> = {
  OPEN: 'Abierta',
  IN_PREPARATION: 'En preparación',
  SERVED: 'Servida',
  PAYMENT_PENDING: 'Pago pendiente',
};

export const saleChannelLabels: Record<SaleChannel, string> = {
  MOSTRADOR: 'Mostrador',
  PARA_LLEVAR: 'Mostrador',
  MESA: 'Mesa',
  DOMICILIO: 'Domicilio',
};

export const pinnedProductCodes = [
  'HAMB-2X1',
  'CC-ORG-1500',
  'HAMBURGESA SAENCILLA',
  'CC-ORG-400',
] as const;

export const quickOrderNotes = [
  'Sin cebolla',
  'Sin papitas',
  'Sin salsa',
  'Extra queso',
  'Primero bebidas',
  'Para llevar',
] as const;

export function sanitizeCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return new Intl.NumberFormat('es-CO').format(Number(digits));
}

export function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function buildPriceInput(value: number | string) {
  return sanitizeCurrencyInput(String(value));
}

export function parsePaymentAmount(value: string) {
  return parseCurrencyInput(value);
}

export function parseReceivedAmount(value: string) {
  return parseCurrencyInput(value);
}

export function distributeTotalAcrossCart(cart: CartItem[], targetTotal: number) {
  if (!cart.length) {
    return [] as Array<{ productId: string; quantity: number; unitPrice: number }>;
  }

  const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  if (subtotal <= 0 || targetTotal === subtotal) {
    return cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.price,
    }));
  }

  const scale = targetTotal / subtotal;
  let accumulated = 0;

  return cart.map((item, index) => {
    if (index === cart.length - 1) {
      const lastLineTotal = Math.max(targetTotal - accumulated, 0);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.quantity > 0 ? lastLineTotal / item.quantity : 0,
      };
    }

    const lineTotal = Math.max(item.price * item.quantity * scale, 0);
    accumulated += lineTotal;

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.quantity > 0 ? lineTotal / item.quantity : 0,
    };
  });
}

export function toggleNoteSnippet(currentNotes: string, snippet: string) {
  const lines = currentNotes
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const alreadyIncluded = lines.includes(snippet);
  const nextLines = alreadyIncluded
    ? lines.filter((line) => line !== snippet)
    : [...lines, snippet];

  return nextLines.join(', ');
}

export function createPaymentRow(paymentMethodId = '', amount = '0', receivedAmount = ''): PaymentRow {
  return {
    paymentMethodId,
    amount,
    receivedAmount,
  };
}

export function getOrderTypeVisual(type: OrderType) {
  switch (type) {
    case 'DINE_IN':
      return {
        pillClass:
          'inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-orange-700',
        label: 'Mesa',
      };
    case 'DELIVERY':
      return {
        pillClass:
          'inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-purple-700',
        label: 'Domicilio',
      };
    case 'TAKEAWAY':
      return {
        pillClass:
          'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-emerald-700',
        label: 'Para llevar',
      };
    case 'COUNTER':
    default:
      return {
        pillClass:
          'inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-600',
        label: 'Directa',
      };
  }
}
