import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ReleaseManifest } from '../../release/release-manifest';
import { evaluateMigrationIdentity, type AppliedMigration } from './migration-identity';

describe('migration identity attestation', () => {
  const expected = [
    { name: '0001_initial', checksum: '243a52df85ce3db511c692443b8e1ac385acf64ea1593a92826fe3ca9efa443d' },
    ...Array.from({ length: 31 }, (_, index) => ({
      name: `202607${String(index + 1).padStart(8, '0')}_migration_${index}`,
      checksum: String(index + 1).padStart(64, '0'),
    })),
  ];
  const attestation = {
    migrationName: '0001_initial',
    repositoryChecksum: '243a52df85ce3db511c692443b8e1ac385acf64ea1593a92826fe3ca9efa443d',
    databaseChecksum: '6bd1cbeb053d2ef72182258a85deedfd01e7f6a7be5add33667342db18893f87',
    classification: 'FILE_ONLY_DRIFT',
    forensicEvidenceCommit: 'aec3c0df6c7d963f54afa3e08b52d35761600199',
    verifiedFrontierMigrationCount: 29,
    structuralDifferenceCount: 0,
    ownerAuthorizationReference: 'SOFIA_PHASE_0_FILE_ONLY_DRIFT_ACCEPTANCE_2026-08-01',
  } as const;

  it('accepts only the exact authorized initial migration pair at 32/32', () => {
    expect(evaluateMigrationIdentity(productionRows(), expected, [attestation])).toEqual({
      compatible: true,
      exact: false,
      status: 'MIGRATION_FILE_ONLY_DRIFT_ATTESTED',
      appliedCount: 32,
      attestedMigrationCount: 1,
      forwardCompatibleMigrationCount: 0,
      forwardCompatibilityEvidence: [],
      forensicEvidenceCommits: ['aec3c0df6c7d963f54afa3e08b52d35761600199'],
    });
  });

  it('accepts only the owner-attested additive Phase 8 migration after frontier 37', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    rows.push({
      migrationName: '20260812130000_sofia_crm_product_core',
      checksum: '64e17e19f394af2e0781032025e1afb293987bda7f95d7c53ed3345800bf1fdd',
      finished: true,
      rolledBack: false,
    });

    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: true,
      exact: false,
      status: 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED',
      appliedCount: 38,
      forwardCompatibleMigrationCount: 1,
      forwardCompatibilityEvidence: ['SOFIA_MACRO_PHASE_8_CRM_DOMAIN_EXTENSION_2026-08-13'],
    });
  });

  it.each([
    ['wrong checksum', '20260812130000_sofia_crm_product_core', 'f'.repeat(64)],
    ['wrong name', '20260812130001_unapproved', '64e17e19f394af2e0781032025e1afb293987bda7f95d7c53ed3345800bf1fdd'],
  ])('blocks an additional migration with %s', (_case, migrationName, checksum) => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    rows.push({ migrationName, checksum, finished: true, rolledBack: false });
    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks duplicate known migration rows instead of collapsing them by name', () => {
    const rows = productionRows();
    rows.push({ ...rows[1]! });
    expect(evaluateMigrationIdentity(rows, expected, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks an unknown migration after the authorized Phase 8 suffix', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    rows.push(
      {
        migrationName: '20260812130000_sofia_crm_product_core',
        checksum: '64e17e19f394af2e0781032025e1afb293987bda7f95d7c53ed3345800bf1fdd',
        finished: true,
        rolledBack: false,
      },
      {
        migrationName: '20260812140000_unknown',
        checksum: 'e'.repeat(64),
        finished: true,
        rolledBack: false,
      },
    );
    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks the forward suffix when an intermediate frontier-37 checksum is altered', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    const altered = frontier37.map((migration, index) =>
      index === 10 ? { ...migration, checksum: 'd'.repeat(64) } : migration,
    );
    rows.push(authorizedForwardRow());

    expect(evaluateMigrationIdentity(rows, altered, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks the forward suffix from an incomplete frontier', () => {
    const frontier36 = repositoryFrontier37Inventory().slice(0, -1);
    const rows = appliedRepositoryRows(frontier36);
    rows.push(authorizedForwardRow());

    expect(evaluateMigrationIdentity(rows, frontier36, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks reordered applied migration history', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    [rows[10], rows[11]] = [rows[11]!, rows[10]!];
    rows.push(authorizedForwardRow());

    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it.each([
    ['unfinished', false, false],
    ['rolled back', true, true],
  ])('blocks an authorized forward migration that is %s', (_case, finished, rolledBack) => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    rows.push({ ...authorizedForwardRow(), finished, rolledBack });

    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks duplicate authorized forward migration rows', () => {
    const frontier37 = repositoryFrontier37Inventory();
    const rows = appliedRepositoryRows(frontier37);
    rows.push(authorizedForwardRow(), authorizedForwardRow());

    expect(evaluateMigrationIdentity(rows, frontier37, [attestation])).toMatchObject({
      compatible: false,
      status: 'MIGRATION_HISTORY_INCOMPATIBLE',
    });
  });

  it('blocks a different migration name', () => {
    const wrong = { ...attestation, migrationName: expected[1]!.name };
    expect(evaluateMigrationIdentity(productionRows(), expected, unsafeAttestations(wrong)).status)
      .toBe('MIGRATION_CHECKSUM_UNATTESTED');
  });

  it('blocks a different production checksum', () => {
    const rows = productionRows();
    rows[0]!.checksum = 'f'.repeat(64);
    expect(evaluateMigrationIdentity(rows, expected, [attestation]).status).toBe('MIGRATION_CHECKSUM_UNATTESTED');
  });

  it('blocks a missing forensic evidence reference', () => {
    const malformed = { ...attestation, forensicEvidenceCommit: '' };
    expect(evaluateMigrationIdentity(productionRows(), expected, unsafeAttestations(malformed)).status)
      .toBe('MIGRATION_CHECKSUM_UNATTESTED');
  });

  it('blocks a missing attestation', () => {
    expect(evaluateMigrationIdentity(productionRows(), expected, []).status).toBe('MIGRATION_CHECKSUM_UNATTESTED');
  });

  it('blocks pending, failed, and rolled-back migration history', () => {
    const pending = productionRows().slice(0, 31);
    const failed = productionRows();
    failed[31]!.finished = false;
    const rolledBack = productionRows();
    rolledBack[31]!.rolledBack = true;

    for (const rows of [pending, failed, rolledBack]) {
      expect(evaluateMigrationIdentity(rows, expected, [attestation]).status).toBe('MIGRATION_HISTORY_INCOMPATIBLE');
    }
  });

  it('preserves exact migration identity without using an attestation', () => {
    const exactRows = expected.map(({ name: migrationName, checksum }) => ({
      migrationName,
      checksum,
      finished: true,
      rolledBack: false,
    }));
    expect(evaluateMigrationIdentity(exactRows, expected, [attestation])).toMatchObject({
      compatible: true,
      exact: true,
      status: 'MIGRATION_STATE_COMPATIBLE',
      attestedMigrationCount: 0,
    });
  });

  function productionRows(): AppliedMigration[] {
    return expected.map(({ name: migrationName, checksum }, index) => ({
      migrationName,
      checksum: index === 0 ? attestation.databaseChecksum : checksum,
      finished: true,
      rolledBack: false,
    }));
  }
});

function unsafeAttestations(value: unknown): ReleaseManifest['migrationAttestations'] {
  return [value] as ReleaseManifest['migrationAttestations'];
}

function repositoryFrontier37Inventory(): ReleaseManifest['migrationInventory'] {
  const root = path.resolve(process.cwd(), '../../prisma/migrations');
  const inventory = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== '20260812130000_sofia_crm_product_core')
    .sort()
    .map((name) => ({
      name,
      // Test inventory is constrained to the repository migration directory above.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      checksum: createHash('sha256').update(readFileSync(path.join(root, name, 'migration.sql'))).digest('hex'),
    }));
  expect(inventory).toHaveLength(37);
  expect(inventory.at(-1)?.name).toBe('20260809030000_sofia_live_operations_recovery_core');
  return inventory;
}

function appliedRepositoryRows(inventory: ReleaseManifest['migrationInventory']): AppliedMigration[] {
  return inventory.map(({ name: migrationName, checksum }, index) => ({
    migrationName,
    checksum: index === 0 ? '6bd1cbeb053d2ef72182258a85deedfd01e7f6a7be5add33667342db18893f87' : checksum,
    finished: true,
    rolledBack: false,
  }));
}

function authorizedForwardRow(): AppliedMigration {
  return {
    migrationName: '20260812130000_sofia_crm_product_core',
    checksum: '64e17e19f394af2e0781032025e1afb293987bda7f95d7c53ed3345800bf1fdd',
    finished: true,
    rolledBack: false,
  };
}
