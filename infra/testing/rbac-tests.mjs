import assert from 'node:assert/strict';
import { accessCodeLogin, apiBase, authHeaders, login, requiredEnv, writeJson } from './runtime-client.mjs';

const tokens = {
  admin: await login(requiredEnv('EPHEMERAL_ADMIN_EMAIL'), requiredEnv('EPHEMERAL_ADMIN_PASSWORD')),
  supervisor: await login('supervisor.e2e@invalid.local', 'Supervisor-E2E-2300!'),
  cashier: await login('cashier@2x1burgerco.local', requiredEnv('EPHEMERAL_CASHIER_PASSWORD')),
  waiter: await accessCodeLogin('waiter', 'E2E Waiter', 'W230001'),
  delivery: await accessCodeLogin('delivery', 'E2E Rider', 'D230001'),
  noAccess: await login('no-access.e2e@invalid.local', 'NoAccess-E2E-2300!'),
};

const matrix = [
  { endpoint: '/users', allow: ['admin', 'supervisor'] },
  { endpoint: '/roles', allow: ['admin', 'supervisor'] },
  { endpoint: '/cash-register/current', allow: ['admin', 'supervisor', 'cashier', 'waiter'] },
  { endpoint: '/cash-register/history', allow: ['admin', 'supervisor'] },
  { endpoint: '/sales', allow: ['admin', 'supervisor', 'cashier'] },
  { endpoint: '/inventory/stock', allow: ['admin'] },
  { endpoint: '/orders/delivery-active', allow: ['admin', 'supervisor', 'cashier', 'delivery'] },
  { endpoint: '/reports/daily', allow: ['admin', 'supervisor', 'cashier'] },
  { endpoint: '/admin/sofia/dashboard/summary', allow: ['admin', 'supervisor', 'cashier'] },
  { endpoint: '/whatsapp/session', allow: ['admin', 'supervisor', 'cashier'] },
];
const roles = ['admin', 'supervisor', 'cashier', 'waiter', 'delivery', 'noAccess'];
const results = [];

for (const row of matrix) {
  const anonymous = await fetch(`${apiBase()}${row.endpoint}`);
  assert.equal(anonymous.status, 401, `${row.endpoint} must distinguish unauthenticated access.`);
  const result = { endpoint: row.endpoint, method: 'GET', unauthenticated: 401 };
  for (const role of roles) {
    const response = await fetch(`${apiBase()}${row.endpoint}`, { headers: authHeaders(tokens[role]) });
    const allowed = row.allow.includes(role);
    assert.equal(response.status, allowed ? 200 : 403, `${role} ${row.endpoint}`);
    result[role] = response.status;
  }
  results.push(result);
}

await writeJson('rbac-results.json', { status: 'PASS', matrix: results });
process.stdout.write(`${JSON.stringify({ status: 'PASS', endpoints: results.length, roleChecks: results.length * 7 })}\n`);
