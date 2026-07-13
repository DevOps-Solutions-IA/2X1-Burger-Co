import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadReleaseManifest, releaseManifestSchema } from './release-manifest';

const manifest = {
  application: 'inventory-fastfood-system',
  releaseVersion: '0.1.0-a1b2c3d',
  gitCommit: 'a'.repeat(40),
  gitCommitShort: 'a'.repeat(7),
  buildTimestamp: '2026-07-13T00:00:00.000Z',
  buildId: '0.1.0-a1b2c3d-1783900800',
  environment: 'staging',
  artifactDigest: null,
  apiVersion: '0.0.1',
  schemaCompatibilityVersion: 'prisma-20260701000000_example',
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
    writeFileSync(file, JSON.stringify({ ...manifest, privateToken: 'not-returned' }));
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
});
