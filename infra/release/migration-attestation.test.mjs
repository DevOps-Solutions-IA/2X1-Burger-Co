import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const contract = JSON.parse(readFileSync(path.join(root, 'infra/release/migration-attestations.json'), 'utf8'));
const attestation = contract.attestations[0];

test('attestation is singular and bound to the tracked 0001 migration bytes', () => {
  const migration = readFileSync(path.join(root, 'prisma/migrations/0001_initial/migration.sql'));
  assert.equal(contract.version, 1);
  assert.equal(contract.attestations.length, 1);
  assert.equal(attestation.migrationName, '0001_initial');
  assert.equal(createHash('sha256').update(migration).digest('hex'), attestation.repositoryChecksum);
});

test('attestation forensic evidence commit and zero-difference report are reachable', () => {
  assert.equal(
    execFileSync('git', ['-C', root, 'cat-file', '-t', attestation.forensicEvidenceCommit], { encoding: 'utf8' }).trim(),
    'commit',
  );
  const report = execFileSync('git', [
    '-C', root, 'show',
    `${attestation.forensicEvidenceCommit}:.engineering/sofia-production/phases/phase-00/schema-structural-diff.md`,
  ], { encoding: 'utf8' });
  assert.equal(attestation.verifiedFrontierMigrationCount, 29);
  assert.equal(attestation.structuralDifferenceCount, 0);
  assert.match(report, /expected-29/u);
  assert.match(report, /\*\*0 differences\*\*/u);
});
