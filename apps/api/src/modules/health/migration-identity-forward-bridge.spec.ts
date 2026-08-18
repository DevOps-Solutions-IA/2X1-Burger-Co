import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ReleaseManifest } from '../../release/release-manifest';
import { evaluateMigrationIdentity, type AppliedMigration } from './migration-identity';

// Covers the migration 39 (20260817120000_sofia_ai_suggestion_correlation)
// forward-compatibility bridge authorized under
// SOFIA_AI_SUGGESTION_CORRELATION_FORWARD_COMPATIBILITY_2026-08-17.
//
// Migration 39 itself is NOT part of this repository/branch (by design --
// this PR only prepares the bridge, it does not ship the migration). Rows
// referencing it are constructed here using its known, independently
// verified name and checksum, exactly as a runtime would see them applied
// to a real database it does not itself contain the migration file for.
//
// The base-37 -> migration-38 bridge (SOFIA_MACRO_PHASE_8_CRM_DOMAIN_EXTENSION_2026-08-13)
// is exercised in migration-identity.spec.ts and is not repeated here except
// where a case must show that adding the base-38 bridge did not change it.

const MIGRATION_39_NAME = '20260817120000_sofia_ai_suggestion_correlation';
const MIGRATION_39_CHECKSUM = '660d122232054cd1d744b8017d90688c45cf3cb0613361ccc12e787246b77d97';
const MIGRATION_38_NAME = '20260812130000_sofia_crm_product_core';
const MIGRATION_38_CHECKSUM = 'adb1e236995f9e0d5b1e87108f4d098d07d53fce3dfdef0f5183bf5c0a2e62d5';
const NO_ATTESTATIONS: ReleaseManifest['migrationAttestations'] = [];

function repositoryFrontier38Inventory(): ReleaseManifest['migrationInventory'] {
  const root = path.resolve(process.cwd(), '../../prisma/migrations');
  const inventory = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      checksum: createHash('sha256').update(readFileSync(path.join(root, name, 'migration.sql'))).digest('hex'),
    }));
  expect(inventory).toHaveLength(38);
  expect(inventory.at(-1)?.name).toBe(MIGRATION_38_NAME);
  return inventory;
}

function repositoryFrontier37Inventory(): ReleaseManifest['migrationInventory'] {
  return repositoryFrontier38Inventory().filter((migration) => migration.name !== MIGRATION_38_NAME);
}

function appliedRepositoryRows(inventory: ReleaseManifest['migrationInventory']): AppliedMigration[] {
  return inventory.map(({ name: migrationName, checksum }) => ({
    migrationName,
    checksum,
    finished: true,
    rolledBack: false,
  }));
}

function migration39Row(overrides: Partial<AppliedMigration> = {}): AppliedMigration {
  return { migrationName: MIGRATION_39_NAME, checksum: MIGRATION_39_CHECKSUM, finished: true, rolledBack: false, ...overrides };
}

function migration38Row(overrides: Partial<AppliedMigration> = {}): AppliedMigration {
  return { migrationName: MIGRATION_38_NAME, checksum: MIGRATION_38_CHECKSUM, finished: true, rolledBack: false, ...overrides };
}

describe('migration 39 forward-compatibility bridge', () => {
  it('Case 1: runtime inventory 37, DB = 37 -> EXACT PASS', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    expect(evaluateMigrationIdentity(rows, frontier37, NO_ATTESTATIONS)).toMatchObject({
      compatible: true,
      exact: true,
      status: 'MIGRATION_STATE_COMPATIBLE',
    });
  });

  it('Case 2: runtime inventory 37, DB = 38 authorized -> FORWARD_COMPATIBLE PASS (unchanged by adding the 38->39 bridge)', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = [...appliedRepositoryRows(frontier37), migration38Row()];
    expect(evaluateMigrationIdentity(rows, frontier37, NO_ATTESTATIONS)).toMatchObject({
      compatible: true,
      exact: false,
      status: 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED',
      forwardCompatibleMigrationCount: 1,
      forwardCompatibilityEvidence: ['SOFIA_MACRO_PHASE_8_CRM_DOMAIN_EXTENSION_2026-08-13'],
    });
  });

  it('Case 3: runtime inventory 38, DB = 38 -> EXACT PASS', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = appliedRepositoryRows(frontier38);
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: true,
      exact: true,
      status: 'MIGRATION_STATE_COMPATIBLE',
    });
  });

  it('Case 4: runtime inventory 38, DB = 39 authorized -> FORWARD_COMPATIBLE PASS', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [...appliedRepositoryRows(frontier38), migration39Row()];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: true,
      exact: false,
      status: 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED',
      forwardCompatibleMigrationCount: 1,
      forwardCompatibilityEvidence: ['SOFIA_AI_SUGGESTION_CORRELATION_FORWARD_COMPATIBILITY_2026-08-17'],
    });
  });

  it('Case 5: runtime inventory 38, DB = migration 39 with an altered checksum -> FAIL CLOSED', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [...appliedRepositoryRows(frontier38), migration39Row({ checksum: 'f'.repeat(64) })];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('Case 6: runtime inventory 38, DB = an unknown migration -> FAIL CLOSED', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [...appliedRepositoryRows(frontier38), { migrationName: '20260817120000_unapproved', checksum: MIGRATION_39_CHECKSUM, finished: true, rolledBack: false }];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('Case 7: runtime inventory 38, DB = 39 + unknown migration 40 -> FAIL CLOSED (no multi-migration suffix authorized)', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [
      ...appliedRepositoryRows(frontier38),
      migration39Row(),
      { migrationName: '20260818000000_unknown', checksum: 'e'.repeat(64), finished: true, rolledBack: false },
    ];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('Case 8: runtime inventory 37, DB = 38 + 39 -> explicitly FAIL CLOSED, not silently accepted as a chain', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = [...appliedRepositoryRows(frontier37), migration38Row(), migration39Row()];
    expect(evaluateMigrationIdentity(rows, frontier37, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('Case 9: incorrect migration order -> FAIL CLOSED', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = appliedRepositoryRows(frontier38);
    [rows[10], rows[11]] = [rows[11]!, rows[10]!];
    rows.push(migration39Row());
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it.each([
    ['unfinished', false, false],
    ['rolled back', true, true],
  ])('Case 10: migration 39 is %s -> FAIL CLOSED', (_case, finished, rolledBack) => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [...appliedRepositoryRows(frontier38), migration39Row({ finished, rolledBack })];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('rejects a bare frontier-37 runtime seeing migration 39 directly (no intervening migration 38 applied)', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = [...appliedRepositoryRows(frontier37), migration39Row()];
    expect(evaluateMigrationIdentity(rows, frontier37, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('does not regress the base-37 bridge when duplicate migration-39 rows are applied on top of frontier 38', () => {
    const frontier38 = repositoryFrontier38Inventory();
    const rows = [...appliedRepositoryRows(frontier38), migration39Row(), migration39Row()];
    expect(evaluateMigrationIdentity(rows, frontier38, NO_ATTESTATIONS)).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });
});
