import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveServiceCasePaymentStatus } from './customer-service-screen';

test('support displays checkout financial review instead of an isolated succeeded intent', () => {
  assert.equal(
    resolveServiceCasePaymentStatus('SUCCEEDED', 'FINANCIAL_REVIEW_REQUIRED'),
    'FINANCIAL_REVIEW_REQUIRED',
  );
  assert.equal(resolveServiceCasePaymentStatus('SUCCEEDED', 'PAYMENT_VERIFIED'), 'SUCCEEDED');
});
