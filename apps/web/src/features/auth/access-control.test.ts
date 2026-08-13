import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessRoute, canMutateCrm, resolveDefaultRoute } from './access-control';

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

test('CRM is readable by cashiers but mutations require an authorized operator role', () => {
  assert.equal(canAccessRoute('/crm/leads', ['orders.read'], ['cashier']), true);
  assert.equal(canMutateCrm(['cashier']), false);
  assert.equal(canMutateCrm(['waiter']), false);
  assert.equal(canMutateCrm(undefined), false);
  assert.equal(canMutateCrm(['supervisor']), true);
  assert.equal(canMutateCrm(['admin']), true);
});

test('generic permissions never expose operational modules to inventory', () => {
  const inventoryPermissions = ['orders.read', 'delivery.read', 'tables.read', 'reports.read'];
  for (const route of ['/sofia', '/crm', '/customers', '/conversations', '/orders', '/kitchen', '/deliveries', '/tables', '/audit']) {
    assert.equal(canAccessRoute(route, inventoryPermissions, ['inventory']), false, route);
  }
});

test('default routes are authorized for every supported operational role', () => {
  const users = [
    { roles: ['admin'], permissions: [], expected: '/dashboard' },
    { roles: ['supervisor'], permissions: [], expected: '/dashboard' },
    { roles: ['cashier'], permissions: [], expected: '/dashboard' },
    { roles: ['inventory'], permissions: ['inventory.read'], expected: '/inventory' },
    { roles: ['waiter'], permissions: ['orders.create'], expected: '/waiter' },
    { roles: ['delivery'], permissions: ['delivery.read'], expected: '/delivery' },
    { roles: ['rider'], permissions: ['delivery.read'], expected: '/delivery' },
  ];

  for (const { roles, permissions, expected } of users) {
    const destination = resolveDefaultRoute({ roles, permissions });
    assert.equal(destination, expected);
    assert.equal(canAccessRoute(destination, permissions, roles), true);
  }
});

test('default route resolution fails closed for unknown roles or missing permissions', () => {
  assert.equal(resolveDefaultRoute(null), '/login');
  assert.equal(resolveDefaultRoute({ roles: [], permissions: [] }), '/login');
  assert.equal(resolveDefaultRoute({ roles: ['unknown'], permissions: ['inventory.read'] }), '/login');
  assert.equal(resolveDefaultRoute({ roles: ['inventory'], permissions: [] }), '/login');
  assert.equal(resolveDefaultRoute({ roles: ['waiter'], permissions: [] }), '/login');
  assert.equal(resolveDefaultRoute({ roles: ['delivery'], permissions: [] }), '/login');
});

test('default route selection preserves role priority without bypassing route policy', () => {
  assert.equal(
    resolveDefaultRoute({
      roles: ['inventory', 'cashier'],
      permissions: ['inventory.read'],
    }),
    '/dashboard',
  );
  assert.equal(
    resolveDefaultRoute({
      roles: ['waiter', 'admin'],
      permissions: [],
    }),
    '/dashboard',
  );
});
