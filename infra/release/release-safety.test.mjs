import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const common = path.join(root, 'infra/scripts/common.sh');
const verifier = path.join(root, 'infra/release/verify-runtime-identity.mjs');
const artifactBuilder = path.join(root, 'infra/release/build-artifacts.sh');
const artifactLoader = path.join(root, 'infra/release/load-artifacts.sh');
const runtimeDigest = path.join(root, 'infra/release/runtime-artifact-digest.mjs');
const ciWorkflow = path.join(root, '.github/workflows/ci.yml');
const cdWorkflow = path.join(root, '.github/workflows/cd.yml');
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
  assert.match(source, /COMMON_ARGS=\(\s*--no-cache/);
  assert.match(source, /RELEASE_REPRODUCIBILITY_SECRET="\$\{RELEASE_REPRODUCIBILITY_SECRET:-\}"/);
  assert.match(source, /EPOCH="\$\(git -C "\$ROOT_DIR" show -s --format=%ct "\$COMMIT"\)"/);
  assert.match(source, /find "\$TEMP_DIR\/\.release" -exec touch -h -d "@\$EPOCH"/);
  for (const dockerfile of [apiDockerfile, webDockerfile]) {
    const dockerSource = readFileSync(dockerfile, 'utf8');
    assert.match(dockerSource, /ARG SOURCE_DATE_EPOCH/);
    assert.match(dockerSource, /find \/app .*touch -h -d "@\$\{SOURCE_DATE_EPOCH\}"/);
  }
  const webSource = readFileSync(webDockerfile, 'utf8');
  assert.match(webSource, /--mount=type=secret,id=release_reproducibility_secret/);
  assert.match(webSource, /node infra\/release\/normalize-next-build\.mjs apps\/web\/\.next/);
  assert.match(webSource, /node infra\/release\/normalize-next-build\.mjs apps\/web\/\.next\/standalone\/apps\/web\/\.next/);
  assert.doesNotMatch(webSource, /ARG (?:NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|RELEASE_REPRODUCIBILITY_SECRET)/);
  assert.match(readFileSync(artifactBuilder, 'utf8'), /--secret id=release_reproducibility_secret,env=RELEASE_REPRODUCIBILITY_SECRET/);
  const loaderSource = readFileSync(artifactLoader, 'utf8');
  assert.match(loaderSource, /archive checksum mismatch/);
  assert.match(loaderSource, /loaded image identity mismatch/);
});

test('artifact builds fail closed and dependency fetch retries are bounded', () => {
  const workflow = readFileSync(ciWorkflow, 'utf8');
  assert.doesNotMatch(workflow, /build-artifacts\.sh[^\n]*\|\s*tail/);
  assert.match(workflow, /FIRST_OUTPUT="\$\(\.\/infra\/release\/build-artifacts\.sh/);
  assert.match(workflow, /SECOND_OUTPUT="\$\(RELEASE_OUTPUT_DIR=/);
  assert.match(workflow, /BASELINE_OUTPUT="\$\(RELEASE_TAG_SUFFIX=-baseline/);
  assert.match(workflow, /test -f "\$FIRST_RECORD"/);
  assert.match(workflow, /test -f "\$SECOND_RECORD"/);
  assert.match(workflow, /test -f "\$BASELINE_RECORD"/);

  for (const dockerfile of [apiDockerfile, webDockerfile]) {
    const source = readFileSync(dockerfile, 'utf8');
    assert.match(source, /for attempt in 1 2 3/);
    assert.match(source, /test "\$attempt" -lt 3 \|\| exit 1/);
    assert.match(source, /sleep "\$\(\(attempt \* 2\)\)"/);
  }
});

test('complete runtime digest includes packaged tmp and run content', () => {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), 'inventory-runtime-rootfs-'));
  for (const directory of ['tmp', 'run', 'proc', 'etc']) {
    mkdirSync(path.join(runtimeRoot, directory), { recursive: true });
  }
  writeFileSync(path.join(runtimeRoot, 'tmp', 'packaged.txt'), 'tmp-v1');
  writeFileSync(path.join(runtimeRoot, 'run', 'packaged.txt'), 'run-v1');
  writeFileSync(path.join(runtimeRoot, 'tmp', 'runtime-artifact-digest.mjs'), 'mounted-helper-v1');
  writeFileSync(path.join(runtimeRoot, 'proc', 'runtime-value'), 'injected-v1');

  const digest = () => execFileSync('node', [runtimeDigest, 'runtime-rootfs', runtimeRoot], { encoding: 'utf8' }).trim();
  const initial = digest();
  writeFileSync(path.join(runtimeRoot, 'tmp', 'packaged.txt'), 'tmp-v2');
  const changedTmp = digest();
  assert.notEqual(changedTmp, initial);
  writeFileSync(path.join(runtimeRoot, 'run', 'packaged.txt'), 'run-v2');
  const changedRun = digest();
  assert.notEqual(changedRun, changedTmp);
  writeFileSync(path.join(runtimeRoot, 'tmp', 'runtime-artifact-digest.mjs'), 'mounted-helper-v2');
  writeFileSync(path.join(runtimeRoot, 'proc', 'runtime-value'), 'injected-v2');
  assert.equal(digest(), changedRun);
});

test('CI third-party actions are pinned to immutable commits', () => {
  const uses = [ciWorkflow, cdWorkflow].flatMap((workflow) => readFileSync(workflow, 'utf8')
    .split('\n')
    .map((line) => line.match(/uses:\s+([^\s#]+)/)?.[1])
    .filter(Boolean));
  assert.ok(uses.length > 0);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/, `${action} is not pinned to a commit`);
  }
});
