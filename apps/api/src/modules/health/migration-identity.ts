import type { ReleaseManifest } from '../../release/release-manifest';

export type AppliedMigration = {
  migrationName: string;
  checksum: string;
  finished: boolean;
  rolledBack: boolean;
};

export type MigrationIdentityStatus =
  | 'MIGRATION_STATE_COMPATIBLE'
  | 'MIGRATION_FILE_ONLY_DRIFT_ATTESTED'
  | 'MIGRATION_CHECKSUM_UNATTESTED'
  | 'MIGRATION_HISTORY_INCOMPATIBLE';

type MigrationIdentityResult = {
  compatible: boolean;
  exact: boolean;
  status: MigrationIdentityStatus;
  appliedCount: number;
  attestedMigrationCount: number;
  forensicEvidenceCommits: string[];
};

const AUTHORIZED_ATTESTATION = {
  migrationName: '0001_initial',
  repositoryChecksum: '243a52df85ce3db511c692443b8e1ac385acf64ea1593a92826fe3ca9efa443d',
  databaseChecksum: '6bd1cbeb053d2ef72182258a85deedfd01e7f6a7be5add33667342db18893f87',
  classification: 'FILE_ONLY_DRIFT',
  forensicEvidenceCommit: 'aec3c0df6c7d963f54afa3e08b52d35761600199',
  verifiedFrontierMigrationCount: 29,
  structuralDifferenceCount: 0,
  ownerAuthorizationReference: 'SOFIA_PHASE_0_FILE_ONLY_DRIFT_ACCEPTANCE_2026-08-01',
} as const;

export function evaluateMigrationIdentity(
  migrations: AppliedMigration[],
  expectedInventory: ReleaseManifest['migrationInventory'],
  attestations: ReleaseManifest['migrationAttestations'],
): MigrationIdentityResult {
  const appliedRows = migrations.filter((migration) => migration.finished && !migration.rolledBack);
  const hasInvalidHistory = migrations.some((migration) => !migration.finished || migration.rolledBack);
  if (
    hasInvalidHistory ||
    expectedInventory.length === 0 ||
    expectedInventory.length !== appliedRows.length
  ) {
    return incompatible('MIGRATION_HISTORY_INCOMPATIBLE', appliedRows.length);
  }

  const actualByName = new Map(appliedRows.map((migration) => [migration.migrationName, migration.checksum]));
  const expectedNames = new Set(expectedInventory.map((migration) => migration.name));
  if (appliedRows.some((migration) => !expectedNames.has(migration.migrationName))) {
    return incompatible('MIGRATION_HISTORY_INCOMPATIBLE', appliedRows.length);
  }

  const mismatches = expectedInventory.filter(
    (migration) => actualByName.get(migration.name) !== migration.checksum,
  );
  if (mismatches.length === 0) {
    return {
      compatible: true,
      exact: true,
      status: 'MIGRATION_STATE_COMPATIBLE',
      appliedCount: appliedRows.length,
      attestedMigrationCount: 0,
      forensicEvidenceCommits: [],
    };
  }

  const accepted = mismatches.map((migration) => {
    const databaseChecksum = actualByName.get(migration.name);
    return attestations.find((attestation) =>
      isAuthorizedAttestation(attestation) &&
      attestation.migrationName === migration.name &&
      attestation.repositoryChecksum === migration.checksum &&
      attestation.databaseChecksum === databaseChecksum
    );
  });
  if (accepted.some((attestation) => attestation === undefined)) {
    return incompatible('MIGRATION_CHECKSUM_UNATTESTED', appliedRows.length);
  }

  const verifiedAttestations = accepted.filter((attestation) => attestation !== undefined);
  return {
    compatible: true,
    exact: false,
    status: 'MIGRATION_FILE_ONLY_DRIFT_ATTESTED',
    appliedCount: appliedRows.length,
    attestedMigrationCount: verifiedAttestations.length,
    forensicEvidenceCommits: verifiedAttestations.map((attestation) => attestation.forensicEvidenceCommit),
  };
}

function isAuthorizedAttestation(attestation: ReleaseManifest['migrationAttestations'][number]): boolean {
  return Object.entries(AUTHORIZED_ATTESTATION).every(
    ([key, value]) => attestation[key as keyof typeof AUTHORIZED_ATTESTATION] === value,
  );
}

function incompatible(status: MigrationIdentityStatus, appliedCount: number): MigrationIdentityResult {
  return {
    compatible: false,
    exact: false,
    status,
    appliedCount,
    attestedMigrationCount: 0,
    forensicEvidenceCommits: [],
  };
}
