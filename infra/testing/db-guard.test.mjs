import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEphemeralDatabaseConfig } from './db-guard.mjs';

const base = {
  runId: 'run-20260713-abcdef12',
  expectedPort: '56123',
  explicitMode: 'true',
  composeProject: 'inventory-e2e-run-20260713-abcdef12',
};
const database = 'inventory_e2e_run_20260713_abcdef12_test';

test('accepts a run-scoped database on its assigned port', () => {
  const result = validateEphemeralDatabaseConfig({
    ...base,
    databaseUrl: `postgresql://e2e_runner:synthetic@127.0.0.1:56123/${database}?schema=public`,
  });
  assert.equal(result.database, database);
});

for (const [name, override] of [
  ['operational database name', { databaseUrl: 'postgresql://e2e_runner:x@127.0.0.1:56123/inventory_fastfood_system' }],
  ['operational port', { databaseUrl: `postgresql://e2e_runner:x@127.0.0.1:5432/${database}` }],
  ['canary port', { databaseUrl: `postgresql://e2e_runner:x@127.0.0.1:55433/${database}` }],
  ['wrong run marker', { databaseUrl: 'postgresql://e2e_runner:x@127.0.0.1:56123/inventory_e2e_other_test' }],
  ['external host', { databaseUrl: `postgresql://e2e_runner:x@db.example.invalid:56123/${database}` }],
  ['missing explicit mode', { explicitMode: 'false', databaseUrl: `postgresql://e2e_runner:x@127.0.0.1:56123/${database}` }],
  ['wrong project', { composeProject: 'inventario', databaseUrl: `postgresql://e2e_runner:x@127.0.0.1:56123/${database}` }],
  ['non scoped user', { databaseUrl: `postgresql://postgres:x@127.0.0.1:56123/${database}` }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateEphemeralDatabaseConfig({ ...base, ...override }));
  });
}
