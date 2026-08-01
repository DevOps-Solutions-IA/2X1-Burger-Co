import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBackupMetadata, readAndVerifyBackupMetadata } from '../scripts/backup-metadata.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const common = path.join(root, 'infra/scripts/common.sh');
const restore = path.join(root, 'infra/scripts/restore.sh');

function executable(filePath, content) {
  writeFileSync(filePath, content, { mode: 0o700 });
  chmodSync(filePath, 0o700);
}

function createHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'inventory-restore-test-'));
  const bin = path.join(directory, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const backup = path.join(directory, 'backup-test.dump.gpg');
  const migrations = path.join(directory, 'migrations.txt');
  const envFile = path.join(directory, 'runtime.env');
  const log = path.join(directory, 'docker.log');
  writeFileSync(backup, 'synthetic-encrypted-archive');
  writeFileSync(migrations, '0001_initial\n0002_users\n');
  writeFileSync(envFile, 'DATABASE_URL=postgresql://test_user:test_password@localhost:5432/production_db\nPOSTGRES_SERVICE=postgres\n');
  createBackupMetadata({
    backupPath: backup,
    migrationListPath: migrations,
    databaseName: 'production_db',
    createdAt: '2026-08-01T00:00:00Z',
  });
  execFileSync('bash', ['-c', 'source "$1"; write_portable_sha256 "$2"; write_portable_sha256 "$3"', '_', common, backup, `${backup}.metadata.json`]);

  executable(path.join(bin, 'gpg'), `#!/usr/bin/env bash
set -euo pipefail
output=""
input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --batch|--quiet|--decrypt) shift ;;
    *) input="$1"; shift ;;
  esac
done
[[ ! -e "$output" ]] || exit 73
cp "$input" "$output"
`);

  executable(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$MOCK_DOCKER_LOG"
[[ "\${1:-}" == compose ]] || exit 2
shift
case "\${1:-}" in
  ps|cp) exit 0 ;;
  exec) shift ;;
  *) exit 2 ;;
esac
[[ "\${1:-}" == -T ]] && shift
shift
if [[ "\${1:-}" == env ]]; then
  shift
  while [[ "\${1:-}" == *=* ]]; do shift; done
fi
command="\${1:-}"
case "$command" in
  pg_restore)
    if [[ " $* " == *" --list "* ]]; then exit 0; fi
    if [[ "\${MOCK_RESTORE_WAIT:-false}" == true ]]; then
      : >"$MOCK_RESTORE_STARTED"
      sleep 30
    fi
    [[ "\${MOCK_RESTORE_FAIL:-false}" != true ]] || exit 42
    ;;
  psql)
    if [[ " $* " == *"pg_database"* ]]; then printf '0\\n'; fi
    if [[ " $* " == *"migration_name"* ]]; then printf '0001_initial\\n0002_users\\n'; fi
    if [[ " $* " == *"required_table"* ]]; then printf '6\\n'; fi
    ;;
  createdb|dropdb|rm) ;;
  *) exit 2 ;;
esac
`);

  return { backup, bin, directory, envFile, log };
}

function harnessEnvironment(harness, overrides = {}) {
  return {
    ...process.env,
    PATH: `${harness.bin}:${process.env.PATH}`,
    RUNTIME_ENV_FILE: harness.envFile,
    MOCK_DOCKER_LOG: harness.log,
    ...overrides,
  };
}

test('backup metadata binds encrypted bytes to the migration identity at creation time', () => {
  const harness = createHarness();
  const metadata = readAndVerifyBackupMetadata({ backupPath: harness.backup });
  assert.equal(metadata.migrationCount, 2);
  writeFileSync(harness.backup, 'tampered');
  assert.throws(() => readAndVerifyBackupMetadata({ backupPath: harness.backup }), /verification failed/u);
});

test('validation database guard rejects production and unprotected names', () => {
  for (const candidate of ['production_db', 'arbitrary_database']) {
    const result = spawnSync('bash', ['-c', 'source "$1"; assert_validation_database_safe "$2" "$3"', '_', common, 'production_db', candidate]);
    assert.notEqual(result.status, 0);
  }
  execFileSync('bash', ['-c', 'source "$1"; assert_validation_database_safe "$2" "$3"', '_', common, 'production_db', 'production_db_restore_validation_1']);
});

test('successful encrypted validation removes the temporary database and plaintext', () => {
  const harness = createHarness();
  execFileSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: harnessEnvironment(harness),
    stdio: 'pipe',
  });
  const log = readFileSync(harness.log, 'utf8');
  assert.match(log, /createdb .*_restore_validation_/u);
  assert.match(log, /dropdb .*_restore_validation_/u);
  const validationDatabase = log.match(/createdb .* ([a-zA-Z0-9_]+_restore_validation_[a-zA-Z0-9_]+)/u)?.[1];
  assert.ok(validationDatabase);
  assert.ok(validationDatabase.length <= 63);
  assert.equal(existsSync(path.join(harness.directory, 'backup.dump')), false);
});

test('failed restore still removes its isolated validation database', () => {
  const harness = createHarness();
  const result = spawnSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: harnessEnvironment(harness, { MOCK_RESTORE_FAIL: 'true' }),
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0);
  assert.match(readFileSync(harness.log, 'utf8'), /dropdb .*_restore_validation_/u);
});

test('interrupted restore executes database and plaintext cleanup', async () => {
  const harness = createHarness();
  const started = path.join(harness.directory, 'restore-started');
  const child = spawn('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    detached: true,
    env: harnessEnvironment(harness, { MOCK_RESTORE_WAIT: 'true', MOCK_RESTORE_STARTED: started }),
    stdio: 'ignore',
  });
  const deadline = Date.now() + 5_000;
  while (!existsSync(started) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(existsSync(started), true);
  process.kill(-child.pid, 'SIGTERM');
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.notEqual(exit.code, 0);
  assert.match(readFileSync(harness.log, 'utf8'), /dropdb .*_restore_validation_/u);
});

test('restore refuses a pre-existing decrypted output instead of overwriting it', () => {
  const source = readFileSync(restore, 'utf8');
  assert.match(source, /\[\[ ! -e "\$DECRYPTED_BACKUP_FILE" \]\]/u);
  assert.doesNotMatch(source, /gpg .*--yes.*--decrypt/u);
});
