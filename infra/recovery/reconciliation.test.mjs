import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { compareReconciliation } from './reconciliation.mjs';

const crmKeys = [
  'crmPipelines',
  'crmPipelineStages',
  'crmLeads',
  'crmLeadStageHistory',
  'crmTasks',
  'crmNotes',
];

function snapshot() {
  return {
    schema: { appliedMigrations: 38, failedMigrations: 0 },
    counts: Object.fromEntries(crmKeys.map((key) => [key, 1])),
    logicalChecksums: Object.fromEntries(crmKeys.map((key) => [key, `${key}-checksum`])),
  };
}

test('reconciliation retains every Phase 8 CRM table as a recovery invariant', () => {
  const sql = readFileSync(path.join(import.meta.dirname, 'reconciliation.sql'), 'utf8');
  for (const key of crmKeys) assert.match(sql, new RegExp(`'${key}'`));
  assert.deepEqual(compareReconciliation(snapshot(), snapshot()).status, 'PASS');
});

test('reconciliation fails when CRM evidence differs after restore', () => {
  const source = snapshot();
  const restored = snapshot();
  restored.logicalChecksums.crmLeadStageHistory = 'lost-history';

  assert.deepEqual(compareReconciliation(source, restored), {
    status: 'FAIL',
    equal: false,
    source,
    restored,
  });
});
