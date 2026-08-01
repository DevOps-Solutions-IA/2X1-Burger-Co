import { constants, openSync, closeSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadReleaseManifest,
  releaseManifestSchema,
  resolveReleaseManifestPath,
} from './release-manifest';
import { ReleaseMetadataService } from './release-metadata.service';

const manifest = {
  releaseManifestVersion: 1 as const,
  application: 'inventory-fastfood-system',
  releaseVersion: '0.1.0-a1b2c3d',
  commitSha: 'a'.repeat(40),
  gitCommit: 'a'.repeat(40),
  gitCommitShort: 'a'.repeat(7),
  buildTimestamp: '2026-07-13T00:00:00.000Z',
  buildId: '0.1.0-a1b2c3d-1783900800',
  environment: 'staging',
  artifactDigest: null,
  apiVersion: '0.0.1',
  schemaCompatibilityVersion: 'prisma-20260701000000_example',
  schemaMigrationCount: 1,
  schemaFingerprint: 'a'.repeat(64),
  migrationCount: 1,
  migrationDigest: 'a'.repeat(64),
  schemaVersion: '20260701000000_example',
  migrationInventory: [{ name: '20260701000000_example', checksum: 'a'.repeat(64) }],
  migrationAttestations: [],
  contractSuiteVersion: 'production-closure-v1',
  frontendBuildId: '0.1.0-a1b2c3d-1783900800',
  backendBuildId: '0.1.0-a1b2c3d-1783900800',
  safetyFlags: {
    realSendingEnabled: false as const,
    autoReplyEnabled: false as const,
    autoSafeEnabled: false as const,
    productionEnabled: false as const,
    whatsappCanMarkPaid: false as const,
  },
  generatedAt: '2026-07-13T00:00:00.000Z',
  dirtyBuild: false,
  sourceRepository: 'inventory-fastfood-system',
};

describe('release manifest contract', () => {
  const originalDigest = process.env.RELEASE_ARTIFACT_DIGEST;

  afterEach(() => {
    if (originalDigest === undefined) delete process.env.RELEASE_ARTIFACT_DIGEST;
    else process.env.RELEASE_ARTIFACT_DIGEST = originalDigest;
  });

  it('strips unknown fields instead of exposing manifest internals', () => {
    const parsed = releaseManifestSchema.parse({ ...manifest, secret: 'must-not-leak' });
    expect(parsed).not.toHaveProperty('secret');
  });

  it('loads a safe runtime digest without exposing unrelated values', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'release-manifest-'));
    const file = path.join(directory, 'release-manifest.json');
    writeTestManifest(file, JSON.stringify({ ...manifest, privateToken: 'not-returned' }));
    process.env.RELEASE_ARTIFACT_DIGEST = `sha256:${'b'.repeat(64)}`;

    try {
      expect(loadReleaseManifest(file)).toEqual({
        ...manifest,
        artifactDigest: `sha256:${'b'.repeat(64)}`,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed commits and artifact digests', () => {
    expect(() => releaseManifestSchema.parse({ ...manifest, gitCommit: 'main' })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...manifest, artifactDigest: 'latest' })).toThrow();
  });

  it('rejects malformed or generalized migration attestations', () => {
    expect(() => releaseManifestSchema.parse({
      ...manifest,
      migrationAttestations: [{ migrationName: '0001_initial' }],
    })).toThrow();
    expect(() => releaseManifestSchema.parse({
      ...manifest,
      migrationAttestations: [{
        migrationName: '0002_other',
        repositoryChecksum: 'a'.repeat(64),
        databaseChecksum: 'b'.repeat(64),
        classification: 'FILE_ONLY_DRIFT',
        forensicEvidenceCommit: 'c'.repeat(40),
        verifiedFrontierMigrationCount: 29,
        structuralDifferenceCount: 0,
        ownerAuthorizationReference: 'arbitrary',
      }],
    })).toThrow();
  });

  it('rejects internally inconsistent schema and component identities', () => {
    expect(() => releaseManifestSchema.parse({ ...manifest, schemaMigrationCount: 2 })).toThrow(
      'Migration inventory must match schemaMigrationCount',
    );
    expect(() => releaseManifestSchema.parse({ ...manifest, frontendBuildId: 'different-build' })).toThrow(
      'Frontend and backend build identities must match',
    );
  });

  it('exposes only the sanitized public version contract', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'release-manifest-'));
    const file = path.join(directory, 'release-manifest.json');
    const originalPath = process.env.RELEASE_MANIFEST_PATH;
    writeTestManifest(file, JSON.stringify(manifest));
    process.env.RELEASE_MANIFEST_PATH = file;

    try {
      expect(new ReleaseMetadataService().getVersion()).toEqual({
        application: 'inventory-fastfood-api',
        environment: 'staging',
        version: manifest.releaseVersion,
        commitSha: manifest.gitCommit,
        buildId: manifest.backendBuildId,
        artifactDigest: null,
        buildTimestamp: manifest.buildTimestamp,
        schemaVersion: manifest.schemaVersion,
        migrationCount: manifest.schemaMigrationCount,
        releaseManifestVersion: 1,
      });
    } finally {
      if (originalPath === undefined) delete process.env.RELEASE_MANIFEST_PATH;
      else process.env.RELEASE_MANIFEST_PATH = originalPath;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when a production runtime has no release manifest', () => {
    const originalPath = process.env.RELEASE_MANIFEST_PATH;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.RELEASE_MANIFEST_PATH = path.join(tmpdir(), 'missing', 'release-manifest.json');
    process.env.NODE_ENV = 'production';

    try {
      expect(() => new ReleaseMetadataService()).toThrow('Release manifest is required in production runtime');
    } finally {
      if (originalPath === undefined) delete process.env.RELEASE_MANIFEST_PATH;
      else process.env.RELEASE_MANIFEST_PATH = originalPath;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('rejects paths that are not the bounded release manifest contract', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'release-manifest-'));
    const wrongName = path.join(directory, 'arbitrary.json');

    try {
      expect(() => resolveReleaseManifestPath(wrongName)).toThrow('must be named release-manifest.json');
      expect(() => resolveReleaseManifestPath(`release-manifest.json\0ignored`)).toThrow('path is invalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized manifest before parsing it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'release-manifest-'));
    const file = path.join(directory, 'release-manifest.json');
    writeTestManifest(file, 'x'.repeat(128 * 1024 + 1));

    try {
      expect(() => loadReleaseManifest(file)).toThrow('bounded regular file');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function writeTestManifest(file: string, contents: string): void {
  const resolved = resolveReleaseManifestPath(file);
  // Test fixtures use the same validated filename boundary as production loading.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const descriptor = openSync(resolved, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try {
    // Writing by descriptor prevents a second pathname resolution in the fixture helper.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(descriptor, contents, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}
