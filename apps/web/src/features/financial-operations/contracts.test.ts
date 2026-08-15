import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentLinkSchema, resolveFinancialTruthStatus } from './contracts';

test('checkout financial review overrides a succeeded payment intent', () => {
  assert.equal(resolveFinancialTruthStatus('SUCCEEDED', 'FINANCIAL_REVIEW_REQUIRED'), 'FINANCIAL_REVIEW_REQUIRED');
  assert.equal(resolveFinancialTruthStatus('SUCCEEDED', 'PAYMENT_VERIFIED'), 'SUCCEEDED');
});

test('payment-link reads require checkout status as financial authority', () => {
  const parsed = paymentLinkSchema.safeParse({
    id: 'link-1',
    paymentIntentId: 'intent-1',
    status: 'ACTIVE',
    expiresAt: '2026-08-13T13:00:00.000Z',
    openedAt: null,
    revokedAt: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    paymentIntent: {
      checkoutId: 'checkout-1',
      status: 'SUCCEEDED',
      amount: 30_000,
      currency: 'COP',
      checkout: { status: 'FINANCIAL_REVIEW_REQUIRED' },
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(
      resolveFinancialTruthStatus(parsed.data.paymentIntent.status, parsed.data.paymentIntent.checkout.status),
      'FINANCIAL_REVIEW_REQUIRED',
    );
  }
});
