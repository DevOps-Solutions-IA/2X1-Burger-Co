import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const common = path.join(root, 'infra/scripts/common.sh');
const verifier = path.join(root, 'infra/release/verify-runtime-identity.mjs');
const artifactBuilder = path.join(root, 'infra/release/build-artifacts.sh');
const apiDockerfile = path.join(root, 'infra/docker/Dockerfile.api');
const webDockerfile = path.join(root, 'infra/docker/Dockerfile.web');
const commit = 'a'.repeat(40);
const apiDigest = `sha256:${'b'.repeat(64)}`;
const webDigest = `sha256:${'c'.repeat(64)}`;

test('image reference validation rejects shell syntax and accepts a pinned registry path', () => {
  execFileSync('bash', ['-c', `source "$1"; validate_image_reference "$2"`, '_', common, `registry.example.com/team/api@${apiDigest}`]);
  const malicious = spawnSync('bash', ['-c', `source "$1"; validate_image_reference "$2"`, '_', common, `registry.example.com/team/api'$(touch /tmp/injected)'@${apiDigest}`]);
  assert.notEqual(malicious.status, 0);
});

test('database URL targeting preserves credentials while replacing only the database', () => {
  const output = execFileSync('bash', [
    '-c',
    `source "$1"; database_url_for_database "$2" "$3"`,
    '_',
    common,
    'postgresql://backup_user:synthetic_password@db.internal:5432/source_db?schema=public',
    'restore_target',
  ], { encoding: 'utf8' });
  const parsed = new URL(output);
  assert.equal(parsed.pathname, '/restore_target');
  assert.equal(parsed.username, 'backup_user');
  assert.equal(parsed.hostname, 'db.internal');
  assert.equal(parsed.searchParams.get('schema'), 'public');
});

test('portable checksum verifies the artifact after relocation and rejects corruption', () => {
  const first = mkdtempSync(path.join(tmpdir(), 'inventory-checksum-source-'));
  const second = mkdtempSync(path.join(tmpdir(), 'inventory-checksum-target-'));
  const artifact = path.join(first, 'backup.dump.gpg');
  writeFileSync(artifact, 'encrypted-test-artifact');
  execFileSync('bash', ['-c', `source "$1"; write_portable_sha256 "$2"`, '_', common, artifact]);
  renameSync(artifact, path.join(second, 'backup.dump.gpg'));
  renameSync(`${artifact}.sha256`, path.join(second, 'backup.dump.gpg.sha256'));
  execFileSync('bash', ['-c', `source "$1"; verify_sha256_file "$2"`, '_', common, path.join(second, 'backup.dump.gpg')]);
  writeFileSync(path.join(second, 'backup.dump.gpg'), 'corrupt');
  const corrupted = spawnSync('bash', ['-c', `source "$1"; verify_sha256_file "$2"`, '_', common, path.join(second, 'backup.dump.gpg')]);
  assert.notEqual(corrupted.status, 0);
});

test('runtime identity requires clean matching commits, build IDs and non-null digests', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'inventory-runtime-identity-'));
  const apiPath = path.join(directory, 'api.json');
  const webPath = path.join(directory, 'web.json');
  const base = { commitSha: commit, buildId: 'build-1', migrationCount: 32, releaseManifestVersion: 1 };
  writeFileSync(apiPath, JSON.stringify({ ...base, artifactDigest: apiDigest }));
  writeFileSync(webPath, JSON.stringify({ ...base, artifactDigest: webDigest }));
  const output = execFileSync('node', [verifier, apiPath, webPath, commit, apiDigest, webDigest], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).digestsVerified, true);

  writeFileSync(apiPath, JSON.stringify({ ...base, artifactDigest: null }));
  const missingDigest = spawnSync('node', [verifier, apiPath, webPath, commit, apiDigest, webDigest]);
  assert.notEqual(missingDigest.status, 0);
  assert.match(readFileSync(webPath, 'utf8'), /build-1/);
});

test('release builds bind BuildKit layer timestamps to the source commit epoch', () => {
  const source = readFileSync(artifactBuilder, 'utf8');
  assert.match(source, /--build-arg "SOURCE_DATE_EPOCH=\$EPOCH"/);
  assert.match(source, /EPOCH="\$\(git -C "\$ROOT_DIR" show -s --format=%ct "\$COMMIT"\)"/);
  assert.match(source, /find "\$TEMP_DIR\/\.release" -exec touch -h -d "@\$EPOCH"/);
  for (const dockerfile of [apiDockerfile, webDockerfile]) {
    const dockerSource = readFileSync(dockerfile, 'utf8');
    assert.match(dockerSource, /ARG SOURCE_DATE_EPOCH/);
    assert.match(dockerSource, /find \/app .*touch -h -d "@\$\{SOURCE_DATE_EPOCH\}"/);
  }
  assert.match(readFileSync(webDockerfile, 'utf8'), /node infra\/release\/normalize-next-build\.mjs apps\/web\/\.next apps\/web\/src/);
  assert.match(readFileSync(artifactBuilder, 'utf8'), /RELEASE_BUILD_ID=\$BUILD_ID/);
});
