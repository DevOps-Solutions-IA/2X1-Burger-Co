import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { compareReconciliation } from './reconciliation.mjs';
import { fingerprintCrmPayload } from './crm-integrity-fingerprint.mjs';

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
  const payloadSql = readFileSync(path.join(import.meta.dirname, 'crm-integrity-payload.sql'), 'utf8');
  for (const key of crmKeys) assert.match(sql, new RegExp(`'${key}'`));
  for (const key of crmKeys) assert.match(payloadSql, new RegExp(`'${key}'`));
  assert.doesNotMatch(sql, /md5\(body\)|md5\(COALESCE\(sanitized_description/i);
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

test('CRM payload integrity is keyed SHA-256 and changes for a removed or altered CRM row', () => {
  const secret = 'a'.repeat(64);
  const source = Object.fromEntries(crmKeys.map((key) => [key, [[key, 'fixture']]]));
  const restored = structuredClone(source);
  restored.crmNotes = [];

  const sourceIntegrity = fingerprintCrmPayload(source, secret);
  const restoredIntegrity = fingerprintCrmPayload(restored, secret);
  assert.match(sourceIntegrity.crmNotes, /^hmac-sha256:[a-f0-9]{64}$/);
  assert.notEqual(sourceIntegrity.crmNotes, restoredIntegrity.crmNotes);
  assert.equal(compareReconciliation(
    { logicalChecksums: { crmIntegrity: sourceIntegrity } },
    { logicalChecksums: { crmIntegrity: restoredIntegrity } },
  ).status, 'FAIL');
});

test('CRM payload integrity fails closed without a valid secret or complete payload', () => {
  const payload = Object.fromEntries(crmKeys.map((key) => [key, []]));
  assert.throws(() => fingerprintCrmPayload(payload, undefined), /32-byte hexadecimal/);
  delete payload.crmNotes;
  assert.throws(() => fingerprintCrmPayload(payload, 'a'.repeat(64)), /missing crmNotes/);
});
