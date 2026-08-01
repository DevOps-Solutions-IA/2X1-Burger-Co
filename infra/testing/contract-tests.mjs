import assert from 'node:assert/strict';
import { apiRequest, assertNoSensitiveFields, authHeaders, login, requiredEnv, writeJson } from './runtime-client.mjs';

const adminToken = await login(requiredEnv('EPHEMERAL_ADMIN_EMAIL'), requiredEnv('EPHEMERAL_ADMIN_PASSWORD'));
const auth = authHeaders(adminToken);
const checks = [];

async function check(name, path, validator, options = {}) {
  const response = await apiRequest(path, { ...options, headers: { ...auth, ...(options.headers ?? {}) } });
  validator(response.body, response);
  assertNoSensitiveFields(response.body, name);
  checks.push({ name, path, status: response.status, result: 'PASS' });
}

const publicHealth = await apiRequest('/health');
assert.equal(publicHealth.body.status, 'ok');
checks.push({ name: 'health', path: '/health', status: 200, result: 'PASS' });

const version = await apiRequest('/version');
for (const key of ['application', 'commitSha', 'buildId', 'environment', 'migrationCount', 'releaseManifestVersion']) assert.ok(key in version.body);
assert.ok(['test', 'e2e'].includes(version.body.environment));
assert.equal('dirtyBuild' in version.body, false);
checks.push({ name: 'version', path: '/version', status: 200, result: 'PASS' });

await check('auth.me', '/auth/me', (body) => assert.equal(typeof body.email, 'string'));
await check('users', '/users', (body) => assert.ok(Array.isArray(body)));
await check('cash', '/cash-register/current', (body) => assert.ok(body === null || typeof body === 'object'));
await check('pos.catalog', '/products/sellable', (body) => assert.ok(Array.isArray(body)));
await check('inventory', '/inventory/stock', (body) => {
  assert.ok(body.metrics && Array.isArray(body.items));
});
await check('delivery', '/orders/delivery-active', (body) => assert.ok(Array.isArray(body)));
await check('sofia.dashboard', '/admin/sofia/dashboard/summary', (body) => {
  assert.equal(body.general.realSendingEnabled, false);
  assert.equal(body.general.autoReplyEnabled, false);
  assert.equal(body.general.autoSafeEnabled, false);
  assert.equal(body.general.productionEnabled, false);
});
await check('sofia.inbox', '/admin/sofia/conversations/inbox', (body) => {
  assert.ok(body.real && body.internalValidation && body.sandbox);
  assert.equal(body.sandbox.hiddenByDefault, true);
});
await check('whatsapp.qr', '/admin/sofia/whatsapp/qr/status', (body) => {
  assert.equal(body.status, 'DISABLED');
  assert.equal(body.connected, false);
  assert.equal(body.adapterReal, false);
  assert.equal(body.qrAvailable, false);
});
await check('whatsapp.status', '/whatsapp/session', (body) => {
  assert.equal(body.enabled, false);
  assert.equal(body.connectionState, 'DISABLED');
});

await writeJson('contract-results.json', { status: 'PASS', checks });
process.stdout.write(`${JSON.stringify({ status: 'PASS', contracts: checks.length })}\n`);
