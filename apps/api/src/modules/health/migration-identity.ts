import { createHash } from 'node:crypto';
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
  | 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED'
  | 'MIGRATION_CHECKSUM_UNATTESTED'
  | 'MIGRATION_HISTORY_INCOMPATIBLE';

type MigrationIdentityResult = {
  compatible: boolean;
  exact: boolean;
  status: MigrationIdentityStatus;
  appliedCount: number;
  attestedMigrationCount: number;
  forwardCompatibleMigrationCount: number;
  forwardCompatibilityEvidence: string[];
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

// Owner-authorized additive forward bridges. Each entry is scoped to exactly
// one base frontier (identified by count + latest migration name + a content
// fingerprint of that exact base inventory) and authorizes exactly one single
// next migration on top of it. Entries are independent per base: a runtime
// whose own expected inventory is frontier 37 is evaluated only against the
// entry whose base matches frontier 37, never against any other entry. This
// keeps each base/next-migration bridge isolated so adding a new entry for a
// later frontier can never change what an earlier frontier's runtime accepts.
// Multi-migration suffixes (more than one unauthorized-by-name row beyond a
// runtime's own expected inventory) are never authorized by this mechanism,
// even if each individual migration has its own bridge entry elsewhere: only
// a single-hop, exactly-one-migration forward step is ever accepted.
const AUTHORIZED_FORWARD_MIGRATIONS = [
  {
    baseMigrationCount: 37,
    baseLatestMigration: '20260809030000_sofia_live_operations_recovery_core',
    baseInventoryFingerprint: '130bc2f2b8338c4340f316bfb740b4933db7a5c93b8d0ddb9b1eb8a59f18d1e8',
    migrationName: '20260812130000_sofia_crm_product_core',
    checksum: 'adb1e236995f9e0d5b1e87108f4d098d07d53fce3dfdef0f5183bf5c0a2e62d5',
    authorizationReference: 'SOFIA_MACRO_PHASE_8_CRM_DOMAIN_EXTENSION_2026-08-13',
  },
  {
    baseMigrationCount: 38,
    baseLatestMigration: '20260812130000_sofia_crm_product_core',
    baseInventoryFingerprint: '5cf17b1a70a5bacfb9e913a9870a1e39c2317dd77133aeccfa991dabb5291c45',
    migrationName: '20260817120000_sofia_ai_suggestion_correlation',
    checksum: '660d122232054cd1d744b8017d90688c45cf3cb0613361ccc12e787246b77d97',
    authorizationReference: 'SOFIA_AI_SUGGESTION_CORRELATION_FORWARD_COMPATIBILITY_2026-08-17',
  },
] as const;

export function evaluateMigrationIdentity(
  migrations: AppliedMigration[],
  expectedInventory: ReleaseManifest['migrationInventory'],
  attestations: ReleaseManifest['migrationAttestations'],
): MigrationIdentityResult {
  const appliedRows = migrations.filter((migration) => migration.finished && !migration.rolledBack);
  const hasInvalidHistory = migrations.some((migration) => !migration.finished || migration.rolledBack);
  if (hasInvalidHistory || expectedInventory.length === 0 || appliedRows.length < expectedInventory.length) {
    return incompatible('MIGRATION_HISTORY_INCOMPATIBLE', appliedRows.length);
  }

  const expectedNames = expectedInventory.map((migration) => migration.name);
  const appliedNames = appliedRows.map((migration) => migration.migrationName);
  if (
    new Set(expectedNames).size !== expectedNames.length ||
    new Set(appliedNames).size !== appliedNames.length ||
    !expectedNames.every((name, index) => appliedNames[index] === name)
  ) {
    return incompatible('MIGRATION_HISTORY_INCOMPATIBLE', appliedRows.length);
  }

  const additionalRows = appliedRows.slice(expectedInventory.length);
  const forwardBridge = additionalRows.length === 0 ? null : findAuthorizedForwardBridge(additionalRows, expectedInventory);
  if (additionalRows.length > 0 && forwardBridge === null) {
    return incompatible('MIGRATION_HISTORY_INCOMPATIBLE', appliedRows.length);
  }

  const actualByName = new Map(appliedRows.map((migration) => [migration.migrationName, migration.checksum]));

  const mismatches = expectedInventory.filter(
    (migration) => actualByName.get(migration.name) !== migration.checksum,
  );
  if (mismatches.length === 0 && additionalRows.length === 0) {
    return {
      compatible: true,
      exact: true,
      status: 'MIGRATION_STATE_COMPATIBLE',
      appliedCount: appliedRows.length,
      attestedMigrationCount: 0,
      forwardCompatibleMigrationCount: 0,
      forwardCompatibilityEvidence: [],
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
  if (additionalRows.length > 0) {
    return {
      compatible: true,
      exact: false,
      status: 'MIGRATION_FORWARD_COMPATIBLE_ATTESTED',
      appliedCount: appliedRows.length,
      attestedMigrationCount: verifiedAttestations.length,
      forwardCompatibleMigrationCount: additionalRows.length,
      forwardCompatibilityEvidence: forwardBridge ? [forwardBridge.authorizationReference] : [],
      forensicEvidenceCommits: verifiedAttestations.map((attestation) => attestation.forensicEvidenceCommit),
    };
  }
  return {
    compatible: true,
    exact: false,
    status: 'MIGRATION_FILE_ONLY_DRIFT_ATTESTED',
    appliedCount: appliedRows.length,
    attestedMigrationCount: verifiedAttestations.length,
    forwardCompatibleMigrationCount: 0,
    forwardCompatibilityEvidence: [],
    forensicEvidenceCommits: verifiedAttestations.map((attestation) => attestation.forensicEvidenceCommit),
  };
}

// Selects the single forward bridge (if any) whose base matches the caller's
// own expected inventory exactly, then requires the additional rows to be
// EXACTLY that one authorized migration -- never zero-or-more, never a chain
// of several. A base with no matching bridge entry, or additional rows that
// don't collapse to exactly that bridge's single migration, yields null
// (fail closed). This is evaluated per runtime: a frontier-37 runtime only
// ever matches the frontier-37 entry, a frontier-38 runtime only ever matches
// the frontier-38 entry, regardless of how many other entries exist.
function findAuthorizedForwardBridge(
  additionalRows: AppliedMigration[],
  expectedInventory: ReleaseManifest['migrationInventory'],
): (typeof AUTHORIZED_FORWARD_MIGRATIONS)[number] | null {
  if (additionalRows.length !== 1) return null;
  const fingerprint = inventoryFingerprint(expectedInventory);
  const bridge = AUTHORIZED_FORWARD_MIGRATIONS.find(
    (candidate) =>
      candidate.baseMigrationCount === expectedInventory.length &&
      candidate.baseLatestMigration === expectedInventory.at(-1)?.name &&
      candidate.baseInventoryFingerprint === fingerprint,
  );
  if (!bridge) return null;
  const [row] = additionalRows;
  return row!.migrationName === bridge.migrationName && row!.checksum === bridge.checksum ? bridge : null;
}

function inventoryFingerprint(inventory: ReleaseManifest['migrationInventory']): string {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
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
    forwardCompatibleMigrationCount: 0,
    forwardCompatibilityEvidence: [],
    forensicEvidenceCommits: [],
  };
}
