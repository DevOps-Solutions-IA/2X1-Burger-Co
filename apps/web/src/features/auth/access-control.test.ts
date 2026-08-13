import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessRoute } from './access-control';

test('financial and support routes align permission and backend role policy', () => {
  assert.equal(canAccessRoute('/payments', ['reports.read'], ['cashier']), false);
  assert.equal(canAccessRoute('/payments', ['reports.read'], ['supervisor']), true);
  assert.equal(canAccessRoute('/customer-service', ['orders.read'], ['cashier']), false);
  assert.equal(canAccessRoute('/customer-service', ['orders.read'], ['admin']), true);
});

test('operational overview is internal and unknown routes fail closed', () => {
  assert.equal(canAccessRoute('/overview', [], ['delivery']), false);
  assert.equal(canAccessRoute('/overview', [], ['cashier']), true);
  assert.equal(canAccessRoute('/not-classified', ['reports.read'], ['admin']), false);
});
