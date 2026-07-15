import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateAppliedMigrations, resolveMigrationExpectation } from './migration-expectation.mjs';

function fixture(count) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-expectation-'));
  const names = [];
  for (let index = 1; index <= count; index += 1) {
    const name = `20260101${String(index).padStart(6, '0')}_migration_${index}`;
    const directory = path.join(root, name);
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'migration.sql'), `-- migration ${index}\nSELECT ${index};\n`);
    names.push(name);
  }
  return { root, names, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

for (const count of [29, 30, 31]) {
  test(`derives ${count} migrations without a configured total`, () => {
    const value = fixture(count);
    try {
      const expectation = resolveMigrationExpectation(value.root);
      assert.equal(expectation.count, count);
      assert.equal(expectation.latest, value.names.at(-1));
      assert.match(expectation.fingerprint, /^[a-f0-9]{64}$/);
    } finally {
      value.cleanup();
    }
  });
}

test('fails closed when a migration file is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-expectation-missing-'));
  const directory = path.join(root, '20260101000001_missing_sql');
  mkdirSync(directory);
  try {
    assert.throws(() => resolveMigrationExpectation(root), /Missing migration\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts the legacy Prisma migration naming convention', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-expectation-legacy-'));
  const directory = path.join(root, '0001_initial');
  mkdirSync(directory);
  writeFileSync(path.join(directory, 'migration.sql'), '-- initial\nSELECT 1;\n');
  try {
    const expectation = resolveMigrationExpectation(root);
    assert.equal(expectation.count, 1);
    assert.equal(expectation.latest, '0001_initial');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects missing, failed, and unexpected applied migrations', () => {
  const value = fixture(3);
  try {
    const expectation = resolveMigrationExpectation(value.root);
    const result = evaluateAppliedMigrations(expectation, [
      { migrationName: value.names[0], finished: true, rolledBack: false },
      { migrationName: value.names[1], finished: false, rolledBack: false },
      { migrationName: '20260101999999_unexpected', finished: true, rolledBack: false },
    ]);
    assert.equal(result.compatible, false);
    assert.deepEqual(result.missing, value.names.slice(1));
    assert.deepEqual(result.failed, [value.names[1]]);
    assert.deepEqual(result.unexpected, ['20260101999999_unexpected']);
  } finally {
    value.cleanup();
  }
});

test('accepts the exact successful migration set', () => {
  const value = fixture(3);
  try {
    const expectation = resolveMigrationExpectation(value.root);
    const rows = value.names.map((migrationName) => ({ migrationName, finished: true, rolledBack: false }));
    assert.equal(evaluateAppliedMigrations(expectation, rows).compatible, true);
  } finally {
    value.cleanup();
  }
});
