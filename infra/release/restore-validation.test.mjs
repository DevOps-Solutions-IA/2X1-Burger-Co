import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBackupMetadata, readAndVerifyBackupMetadata } from '../scripts/backup-metadata.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const common = path.join(root, 'infra/scripts/common.sh');
const backupScript = path.join(root, 'infra/scripts/backup.sh');
const restore = path.join(root, 'infra/scripts/restore.sh');
const sourceSha = '373876c018f56ced87fc56295e727ed0d2ef19ab';
const recipientFingerprint = 'AC279CC063D34EA46E59D96CC3B71C3A1908DC85';
const signingFingerprint = 'BB81CF23EFA661184134D97D1DF17AF79C15C871';
const databaseIdentity = 'host=db.internal\nport=5432\ndatabase=production_db\ncluster=7341234567890123456\n';

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
  const gpgLog = path.join(directory, 'gpg.log');
  const gpgHome = path.join(directory, 'gnupg');
  const databaseIdentityPath = path.join(directory, 'database-identity.txt');
  mkdirSync(gpgHome, { mode: 0o700 });
  chmodSync(gpgHome, 0o700);
  writeFileSync(backup, 'synthetic-encrypted-archive');
  writeFileSync(migrations, '0001_initial\n0002_users\n');
  writeFileSync(databaseIdentityPath, databaseIdentity, { mode: 0o600 });
  writeFileSync(envFile, 'DATABASE_URL=postgresql://test_user:test_password@localhost:5432/production_db\nPOSTGRES_SERVICE=postgres\n');
  const { metadata } = createBackupMetadata({
    backupPath: backup,
    migrationListPath: migrations,
    databaseIdentityPath,
    createdAt: '2026-08-01T00:00:00Z',
    sourceSha,
    recipientFingerprint,
    signingFingerprint,
    environment: 'production',
  });
  writeFileSync(`${backup}.sig`, 'valid-signature\n', { mode: 0o600 });
  writeFileSync(`${backup}.metadata.json.sig`, 'valid-signature\n', { mode: 0o600 });
  execFileSync('bash', ['-c', 'source "$1"; write_portable_sha256 "$2"; write_portable_sha256 "$3"', '_', common, backup, `${backup}.metadata.json`]);

  executable(path.join(bin, 'gpg'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_GPG_LOG"
if [[ " $* " == *" --list-keys "* || " $* " == *" --list-secret-keys "* ]]; then
  requested="\${!#}"
  if [[ "$requested" == "$MOCK_GPG_RECIPIENT_FINGERPRINT" || "$requested" == "$MOCK_GPG_SIGNING_FINGERPRINT" ]]; then
    printf 'fpr:::::::::%s:\n' "$requested"
  fi
  exit 0
fi
if [[ " $* " == *" --verify "* ]]; then
  while [[ $# -gt 0 && "$1" != --verify ]]; do shift; done
  shift
  signature="$1"
  signed_file="$2"
  [[ -f "$signed_file" && "\${MOCK_GPG_SIGNATURE_VALID:-true}" == true ]]
  [[ "$(cat "$signature")" == valid-signature ]]
  printf '[GNUPG:] VALIDSIG %s 2026-08-09 0 4 0 1 10 00 %s\n' \
    "$MOCK_GPG_SIGNING_FINGERPRINT" "$MOCK_GPG_SIGNING_FINGERPRINT"
  exit 0
fi
output=""
input=""
mode=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --recipient|--local-user|--status-fd) shift 2 ;;
    --decrypt) mode="decrypt"; shift ;;
    --encrypt) mode="encrypt"; shift ;;
    --detach-sign) mode="sign"; shift ;;
    --batch|--quiet|--with-colons|--list-keys|--list-secret-keys|--) shift ;;
    *) input="$1"; shift ;;
  esac
done
case "$mode" in
  encrypt)
    [[ ! -e "$output" ]] || exit 73
    if [[ -n "$input" ]]; then cat "$input" >"$output"; else cat >"$output"; fi
    ;;
  decrypt) cat "$input" ;;
  sign)
    [[ ! -e "$output" ]] || exit 73
    printf 'valid-signature\n' >"$output"
    ;;
  *) exit 2 ;;
esac
`);

  executable(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$MOCK_DOCKER_LOG"
[[ "\${1:-}" == compose ]] || exit 2
shift
case "\${1:-}" in
  ps) exit 0 ;;
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
    if [[ " $* " == *" --list "* ]]; then cat >/dev/null; exit 0; fi
    if [[ "\${MOCK_RESTORE_WAIT:-false}" == true ]]; then
      : >"$MOCK_RESTORE_STARTED"
      sleep 30
    fi
    [[ "\${MOCK_RESTORE_FAIL:-false}" != true ]] || exit 42
    cat >/dev/null
    ;;
  psql)
    if [[ " $* " == *"pg_database"* ]]; then printf '0\\n'; fi
    if [[ " $* " == *"migration_name"* ]]; then printf '0001_initial\\n0002_users\\n'; fi
    if [[ " $* " == *"required_table"* ]]; then printf '6\\n'; fi
    if [[ " $* " == *"pg_control_system"* ]]; then printf '7341234567890123456\\n'; fi
    ;;
  pg_dump) printf 'synthetic-postgresql-dump' ;;
  createdb|dropdb|rm) ;;
  *) exit 2 ;;
esac
`);

  return {
    backup,
    bin,
    databaseIdentityHash: metadata.databaseIdentityHash,
    databaseIdentityPath,
    directory,
    envFile,
    gpgHome,
    gpgLog,
    log,
    migrations,
  };
}

function harnessEnvironment(harness, overrides = {}) {
  return {
    ...process.env,
    PATH: `${harness.bin}:${process.env.PATH}`,
    RUNTIME_ENV_FILE: harness.envFile,
    MOCK_DOCKER_LOG: harness.log,
    MOCK_GPG_LOG: harness.gpgLog,
    BACKUP_SIGNING_GNUPGHOME: harness.gpgHome,
    EXPECTED_BACKUP_DATABASE_IDENTITY_HASH: harness.databaseIdentityHash,
    EXPECTED_BACKUP_SIGNING_FINGERPRINT: signingFingerprint,
    GNUPGHOME: harness.gpgHome,
    MOCK_GPG_RECIPIENT_FINGERPRINT: recipientFingerprint,
    MOCK_GPG_SIGNING_FINGERPRINT: signingFingerprint,
    ...overrides,
  };
}

test('backup metadata binds encrypted bytes to the migration identity at creation time', () => {
  const harness = createHarness();
  const metadata = readAndVerifyBackupMetadata({ backupPath: harness.backup });
  assert.equal(metadata.migrationCount, 2);
  assert.equal(metadata.formatVersion, 2);
  assert.equal(metadata.sourceSha, sourceSha);
  assert.equal(metadata.recipientFingerprint, recipientFingerprint);
  assert.equal(metadata.signingFingerprint, signingFingerprint);
  assert.equal(metadata.environment, 'production');
  assert.match(metadata.databaseIdentityHash, /^sha256:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(metadata), /db\.internal|production_db|7341234567890123456/u);
  writeFileSync(harness.backup, 'tampered');
  assert.throws(() => readAndVerifyBackupMetadata({ backupPath: harness.backup }), /verification failed/u);
});

test('metadata v2 fails closed on release identity mismatch', () => {
  const harness = createHarness();
  assert.throws(() => readAndVerifyBackupMetadata({
    backupPath: harness.backup,
    expectedSourceSha: '0000000000000000000000000000000000000000',
    requireFormatVersion: 2,
  }), /identity verification failed/u);
  assert.throws(() => readAndVerifyBackupMetadata({
    backupPath: harness.backup,
    expectedRecipientFingerprint: '0000000000000000000000000000000000000000',
    requireFormatVersion: 2,
  }), /identity verification failed/u);
  assert.throws(() => readAndVerifyBackupMetadata({
    backupPath: harness.backup,
    expectedSigningFingerprint: '0000000000000000000000000000000000000000',
    requireFormatVersion: 2,
  }), /identity verification failed/u);
});

test('historical metadata v1 remains readable but cannot satisfy v2 release expectations', () => {
  const harness = createHarness();
  const legacyBackup = path.join(harness.directory, 'legacy.dump.gpg');
  writeFileSync(legacyBackup, 'legacy-encrypted-archive');
  createBackupMetadata({
    backupPath: legacyBackup,
    migrationListPath: harness.migrations,
    databaseName: 'production_db',
    createdAt: '2026-07-01T00:00:00Z',
    formatVersion: 1,
  });
  assert.equal(readAndVerifyBackupMetadata({ backupPath: legacyBackup }).formatVersion, 1);
  assert.throws(() => readAndVerifyBackupMetadata({
    backupPath: legacyBackup,
    requireFormatVersion: 2,
  }), /format version/u);
});

test('backup requires explicit custody inputs and emits verified metadata v2', () => {
  const harness = createHarness();
  const backupDirectory = path.join(harness.directory, 'backups');
  const baseEnvironment = harnessEnvironment(harness, {
    BACKUP_DIR: backupDirectory,
    BACKUP_ENVIRONMENT: 'production',
    BACKUP_GPG_RECIPIENT: recipientFingerprint,
    BACKUP_GPG_SIGNING_FINGERPRINT: signingFingerprint,
    BACKUP_KEEP_COUNT: '2',
    BACKUP_RETENTION_DAYS: '365',
    BACKUP_SOURCE_SHA: sourceSha,
  });
  const missingKeyring = spawnSync('bash', [backupScript], {
    cwd: root,
    env: { ...baseEnvironment, GNUPGHOME: '' },
    stdio: 'pipe',
  });
  assert.notEqual(missingKeyring.status, 0);
  assert.match(missingKeyring.stderr.toString(), /GNUPGHOME/u);

  execFileSync('bash', [backupScript], {
    cwd: root,
    env: { ...baseEnvironment, GNUPGHOME: harness.gpgHome },
    stdio: 'pipe',
  });
  const encryptedBackup = readdirSync(backupDirectory)
    .find((entry) => entry.endsWith('.dump.gpg'));
  assert.ok(encryptedBackup);
  const backupPath = path.join(backupDirectory, encryptedBackup);
  const metadata = readAndVerifyBackupMetadata({
    backupPath,
    expectedSourceSha: sourceSha,
    expectedRecipientFingerprint: recipientFingerprint,
    expectedSigningFingerprint: signingFingerprint,
    expectedEnvironment: 'production',
    requireFormatVersion: 2,
  });
  assert.equal(metadata.formatVersion, 2);
  assert.equal(existsSync(`${backupPath}.sig`), true);
  assert.equal(existsSync(`${backupPath}.metadata.json.sig`), true);
  assert.doesNotMatch(JSON.stringify(metadata), /localhost|production_db|7341234567890123456/u);
});

test('strict restore verifies metadata v2, expected source and explicit secret-key custody', () => {
  const harness = createHarness();
  execFileSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: harnessEnvironment(harness, {
      EXPECTED_BACKUP_ENVIRONMENT: 'production',
      EXPECTED_BACKUP_RECIPIENT_FINGERPRINT: recipientFingerprint,
      EXPECTED_BACKUP_SOURCE_SHA: sourceSha,
      GNUPGHOME: harness.gpgHome,
      REQUIRE_BACKUP_METADATA_V2: 'true',
    }),
    stdio: 'pipe',
  });
  assert.match(readFileSync(harness.gpgLog, 'utf8'), /--list-secret-keys/u);
  assert.match(readFileSync(harness.gpgLog, 'utf8'), /--verify/u);
});

test('strict release controls supplied by the caller cannot be weakened by runtime env', () => {
  const harness = createHarness();
  writeFileSync(harness.envFile, [
    'DATABASE_URL=postgresql://test_user:test_password@localhost:5432/production_db',
    'POSTGRES_SERVICE=postgres',
    'REQUIRE_BACKUP_METADATA_V2=false',
    'EXPECTED_BACKUP_SOURCE_SHA=0000000000000000000000000000000000000000',
    'EXPECTED_BACKUP_DATABASE_IDENTITY_HASH=sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'EXPECTED_BACKUP_SIGNING_FINGERPRINT=0000000000000000000000000000000000000000',
  ].join('\n'));
  execFileSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: harnessEnvironment(harness, {
      EXPECTED_BACKUP_ENVIRONMENT: 'production',
      EXPECTED_BACKUP_RECIPIENT_FINGERPRINT: recipientFingerprint,
      EXPECTED_BACKUP_SOURCE_SHA: sourceSha,
      REQUIRE_BACKUP_METADATA_V2: 'true',
    }),
    stdio: 'pipe',
  });
  const gpgCalls = readFileSync(harness.gpgLog, 'utf8');
  assert.match(gpgCalls, /--verify/u);
  assert.match(gpgCalls, /--list-secret-keys/u);
});

test('forged detached signature fails before any backup decryption', () => {
  const harness = createHarness();
  writeFileSync(`${harness.backup}.sig`, 'forged-signature\n');
  const result = spawnSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: harnessEnvironment(harness),
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /signature verification failed/u);
  assert.doesNotMatch(readFileSync(harness.gpgLog, 'utf8'), /--decrypt/u);
});

test('strict metadata v2 requires an independently supplied database identity hash', () => {
  const harness = createHarness();
  const environment = harnessEnvironment(harness, {
    EXPECTED_BACKUP_DATABASE_IDENTITY_HASH: '',
    EXPECTED_BACKUP_ENVIRONMENT: 'production',
    EXPECTED_BACKUP_RECIPIENT_FINGERPRINT: recipientFingerprint,
    EXPECTED_BACKUP_SOURCE_SHA: sourceSha,
    REQUIRE_BACKUP_METADATA_V2: 'true',
  });
  const result = spawnSync('bash', [restore, harness.backup, '--validate-only'], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /DATABASE_IDENTITY_HASH is required/u);
});

test('validation database guard rejects production and unprotected names', () => {
  for (const candidate of ['production_db', 'arbitrary_database']) {
    const result = spawnSync('bash', ['-c', 'source "$1"; assert_validation_database_safe "$2" "$3"', '_', common, 'production_db', candidate]);
    assert.notEqual(result.status, 0);
  }
  execFileSync('bash', ['-c', 'source "$1"; assert_validation_database_safe "$2" "$3"', '_', common, 'production_db', 'production_db_restore_validation_1']);
});

test('successful encrypted validation streams plaintext and removes the temporary database', () => {
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
  assert.doesNotMatch(log, / compose cp /u);
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

test('interrupted streamed restore executes isolated database cleanup', async () => {
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

test('backup and restore contain no plaintext dump or container-copy path', () => {
  const backupSource = readFileSync(backupScript, 'utf8');
  const restoreSource = readFileSync(restore, 'utf8');
  assert.doesNotMatch(backupSource, /PLAINTEXT_BACKUP_FILE|\.dump"/u);
  assert.match(backupSource, /pg_dump[\s\S]+\| GNUPGHOME=/u);
  assert.match(backupSource, /flock -n 9/u);
  assert.doesNotMatch(restoreSource, /DECRYPTED_BACKUP_FILE|CONTAINER_BACKUP_PATH|docker compose cp/u);
  assert.match(restoreSource, /decrypt_backup_stream[\s\\]+\| docker compose exec/u);
});

test('explicit target restore consumes a fresh decrypt stream without container files', () => {
  const harness = createHarness();
  execFileSync('bash', [restore, harness.backup, '--database', 'staging_restore'], {
    cwd: root,
    env: harnessEnvironment(harness, {
      EXPECTED_BACKUP_ENVIRONMENT: 'production',
      EXPECTED_BACKUP_RECIPIENT_FINGERPRINT: recipientFingerprint,
      EXPECTED_BACKUP_SOURCE_SHA: sourceSha,
      FORCE_RESTORE: 'true',
      NODE_ENV: 'test',
      REQUIRE_BACKUP_METADATA_V2: 'true',
      SKIP_BACKUP_BEFORE_RESTORE: 'true',
    }),
    stdio: 'pipe',
  });
  const dockerCalls = readFileSync(harness.log, 'utf8');
  assert.match(dockerCalls, /dropdb .* staging_restore/u);
  assert.match(dockerCalls, /createdb .* staging_restore/u);
  assert.doesNotMatch(dockerCalls, / compose cp /u);
});

test('target restore rejects unsigned historical metadata before destructive database commands', () => {
  const harness = createHarness();
  rmSync(`${harness.backup}.metadata.json`);
  createBackupMetadata({
    backupPath: harness.backup,
    migrationListPath: harness.migrations,
    databaseName: 'production_db',
    createdAt: '2026-08-01T00:00:00Z',
    formatVersion: 1,
  });
  execFileSync('bash', ['-c', 'source "$1"; write_portable_sha256 "$2"', '_', common, `${harness.backup}.metadata.json`]);
  const result = spawnSync('bash', [restore, harness.backup, '--database', 'staging_restore'], {
    cwd: root,
    env: harnessEnvironment(harness, {
      FORCE_RESTORE: 'true',
      NODE_ENV: 'test',
      SKIP_BACKUP_BEFORE_RESTORE: 'true',
    }),
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /Every target restore requires signed metadata v2|metadata v1 cannot satisfy release identity expectations/u);
  assert.doesNotMatch(readFileSync(harness.log, 'utf8'), /dropdb .* staging_restore/u);
  assert.match(readFileSync(restore, 'utf8'), /Every target restore requires signed metadata v2/u);
});
