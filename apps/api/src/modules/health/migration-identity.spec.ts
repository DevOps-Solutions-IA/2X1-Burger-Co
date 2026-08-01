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
      forensicEvidenceCommits: ['aec3c0df6c7d963f54afa3e08b52d35761600199'],
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
