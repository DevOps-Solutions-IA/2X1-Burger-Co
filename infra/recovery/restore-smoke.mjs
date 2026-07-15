import assert from 'node:assert/strict';
import { apiRequest, authHeaders, login, requiredEnv, writeJson } from '../testing/runtime-client.mjs';

const live = await apiRequest('/health/live');
assert.equal(live.body.status, 'ALIVE');
const ready = await apiRequest('/health/ready');
assert.equal(ready.body.status, 'READY');
assert.equal(ready.body.checks.migrationCompatible, true);
const expectedMigrationCount = Number(requiredEnv('EPHEMERAL_EXPECTED_MIGRATION_COUNT'));
assert.ok(Number.isSafeInteger(expectedMigrationCount) && expectedMigrationCount > 0);
assert.equal(ready.body.checks.expectedMigrations, expectedMigrationCount);
assert.equal(ready.body.checks.appliedMigrations, expectedMigrationCount);

const version = await apiRequest('/version');
assert.equal(version.body.environment, 'test');
assert.equal(version.body.dirtyBuild, requiredEnv('EPHEMERAL_EXPECTED_DIRTY_BUILD') === 'true');

const token = await login(requiredEnv('EPHEMERAL_ADMIN_EMAIL'), requiredEnv('EPHEMERAL_ADMIN_PASSWORD'));
const headers = authHeaders(token);
const paths = [
  '/cash-register/current',
  '/products/sellable',
  '/orders/delivery-active',
  '/inventory/stock',
  '/admin/sofia/dashboard/summary',
];
for (const path of paths) await apiRequest(path, { headers });

const metrics = await apiRequest('/health/metrics');
assert.equal(metrics.body.status, 'READY');
assert.equal(metrics.body.metrics.database.available, true);
assert.equal(metrics.body.metrics.recovery.status, 'PASS');
assert.equal(metrics.body.metrics.recovery.checksumVerified, true);
assert.equal(metrics.body.metrics.recovery.restoreVerified, true);
assert.equal(metrics.body.metrics.effectiveFlags.realSendingEnabled, false);
assert.equal(metrics.body.metrics.effectiveFlags.autoReplyEnabled, false);
assert.equal(metrics.body.metrics.effectiveFlags.autoSafeEnabled, false);
assert.equal(metrics.body.metrics.effectiveFlags.productionEnabled, false);
assert.equal(metrics.body.metrics.business, null);
assert.equal(metrics.body.metrics.sofiaWhatsapp, null);

const observability = await apiRequest('/health/observability', { headers });
assert.notEqual(observability.body.metrics.business, null);

await writeJson('restore-smoke.json', {
  status: 'PASS',
  live: true,
  ready: true,
  version: { buildId: version.body.buildId, dirtyBuild: version.body.dirtyBuild },
  readOnlyRoutes: paths.length,
  metrics: true,
  protectedObservability: true,
  realWhatsapp: 'OFF',
});
process.stdout.write(`${JSON.stringify({ status: 'PASS', readOnlyRoutes: paths.length })}\n`);
