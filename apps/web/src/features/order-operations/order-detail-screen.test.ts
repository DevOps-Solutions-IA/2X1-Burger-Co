import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrderDetail } from './contracts';
import { orderDetailSchema } from './contracts';
import { resolveOrderDetailPayment } from './order-detail-screen';

function financialOrder(
  status: 'UNKNOWN_RESULT' | 'FINANCIAL_REVIEW_REQUIRED' | 'SUCCEEDED',
): OrderDetail {
  return {
    orderCheckout: {
      id: 'checkout-1',
      status: status === 'FINANCIAL_REVIEW_REQUIRED' ? status : 'PAYMENT_PENDING',
      paymentPreference: 'ONLINE',
      total: 30_000,
      currency: 'COP',
      paymentIntents: [{
        id: 'intent-2',
        attemptNumber: 2,
        provider: 'BOLD',
        amount: 30_000,
        currency: 'COP',
        status,
        failureCode: status === 'UNKNOWN_RESULT' ? 'PROVIDER_TIMEOUT' : null,
        completedAt: null,
        updatedAt: '2026-08-13T00:00:00.000Z',
      }],
    },
    sale: {
      id: 'sale-legacy',
      status: 'PAID',
      total: 30_000,
      payments: [],
    },
    whatsappDeliveryOrder: {
      id: 'delivery-legacy',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentMethod: 'ONLINE',
      paymentReviewReason: null,
      paymentFailureReason: null,
      paymentEvents: [],
    },
  } as unknown as OrderDetail;
}

test('accepts bounded canonical checkout payment intents in the detail contract', () => {
  const order = financialOrder('UNKNOWN_RESULT');

  assert.equal(orderDetailSchema.shape.orderCheckout.safeParse(order.orderCheckout).success, true);
});

test('keeps UNKNOWN_RESULT authoritative when legacy evidence says paid', () => {
  const payment = resolveOrderDetailPayment(financialOrder('UNKNOWN_RESULT'));

  assert.equal(payment.authority, 'Checkout e intento de pago canónicos');
  assert.equal(payment.status, 'UNKNOWN_RESULT');
  assert.equal(payment.label, 'Resultado financiero desconocido');
  assert.notEqual(payment.label, 'Pago verificado');
});

test('keeps financial review distinct from verified success', () => {
  const payment = resolveOrderDetailPayment(financialOrder('FINANCIAL_REVIEW_REQUIRED'));

  assert.equal(payment.status, 'FINANCIAL_REVIEW_REQUIRED');
  assert.equal(payment.label, 'Revisión financiera requerida');
  assert.notEqual(payment.label, 'Pago verificado');
});

test('renders success only from a canonical succeeded intent', () => {
  const payment = resolveOrderDetailPayment(financialOrder('SUCCEEDED'));

  assert.equal(payment.status, 'SUCCEEDED');
  assert.equal(payment.label, 'Pago verificado');
});
