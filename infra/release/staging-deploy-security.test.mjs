import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/cd.yml'), 'utf8');
const deploy = readFileSync(path.join(root, 'infra/release/staging-deploy.sh'), 'utf8');

test('validation is protected by staging and binds the workflow checkout to the exact release SHA', () => {
  assert.match(workflow, /validate:\n\s+runs-on: ubuntu-latest\n\s+environment: staging/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_commit \}\}/);
  assert.match(workflow, /WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /test "\$WORKFLOW_SHA" = "\$RELEASE_COMMIT"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_COMMIT"/);
});

test('workflow and remote deploy enforce exact API and Web repository allowlists', () => {
  for (const variable of ['STAGING_API_IMAGE_REPOSITORY', 'STAGING_WEB_IMAGE_REPOSITORY']) {
    assert.match(workflow, new RegExp(`vars\\.${variable}`));
  }
  assert.match(workflow, /test "\$\{API_IMAGE%@sha256:\*\}" = "\$ALLOWED_API_IMAGE_REPOSITORY"/);
  assert.match(workflow, /test "\$\{WEB_IMAGE%@sha256:\*\}" = "\$ALLOWED_WEB_IMAGE_REPOSITORY"/);
  assert.match(deploy, /\[\[ "\$\{API_IMAGE%@sha256:\*\}" == "\$ALLOWED_API_IMAGE_REPOSITORY" \]\]/);
  assert.match(deploy, /\[\[ "\$\{WEB_IMAGE%@sha256:\*\}" == "\$ALLOWED_WEB_IMAGE_REPOSITORY" \]\]/);
});

test('remote checkout is exact and clean and deploy executes its release-bound script', () => {
  assert.doesNotMatch(workflow, /\bscp\b/);
  assert.match(workflow, /cd %q && test "\$\(git rev-parse HEAD\)" = %q/);
  assert.match(workflow, /bash \.\/infra\/release\/staging-deploy\.sh/);
  assert.match(deploy, /git rev-parse HEAD/);
  assert.match(deploy, /git diff --quiet && git diff --cached --quiet/);
  assert.match(deploy, /git status --porcelain --untracked-files=all/);
});

test('artifacts are pulled and inspected before backup or migration without starting unverified images', () => {
  const pull = deploy.indexOf('docker pull "$API_IMAGE"');
  const verify = deploy.indexOf('verify_release_image "$API_IMAGE"');
  const backup = deploy.indexOf('BACKUP_OUTPUT=');
  const migration = deploy.indexOf('prisma migrate deploy');
  assert.ok(pull > 0 && verify > pull && backup > verify && migration > backup);
  assert.match(deploy, /docker create --network none --entrypoint \/bin\/false/);
  assert.doesNotMatch(deploy.slice(0, verify), /docker compose .*run/);
  assert.match(deploy, /Artifact revision label does not match the release commit/);
  assert.match(deploy, /Artifact release manifest failed the staging contract/);
  assert.match(deploy, /candidate-api\.json/);
  assert.match(deploy, /baseline-api\.json/);
});

test('a checksum-attested rollback baseline is mandatory and rollback never rebuilds', () => {
  const baseline = deploy.indexOf('read_release_state "$STATE_DIR/current.env"');
  const pull = deploy.indexOf('docker pull "$API_IMAGE"');
  assert.ok(baseline > 0 && baseline < pull);
  assert.match(deploy, /A validated rollback baseline is required/);
  assert.match(deploy, /Rollback baseline attestation does not match its state/);
  assert.match(deploy, /BASELINE_API_IMAGE/);
  assert.match(deploy, /rollback_to_baseline\(\)/);
  assert.match(deploy, /Candidate startup failed; the validated baseline was restored/);
  assert.match(deploy, /if ! API_IMAGE="\$API_IMAGE" WEB_IMAGE="\$WEB_IMAGE"/);
  assert.doesNotMatch(deploy, /docker (?:compose )?build/);
  assert.match(deploy, /Staging backups must be stored outside the clean checkout/);
  assert.match(deploy, /Release state directory must not be a symbolic link/);
  assert.match(deploy, /Staging backup directory must not be a symbolic link/);
  assert.match(deploy, /BACKUP_SOURCE_SHA="\$BASELINE_RELEASE_COMMIT"/);
  assert.match(deploy, /BACKUP_ENVIRONMENT=staging/);
  assert.match(deploy, /REQUIRE_BACKUP_METADATA_V2=true/);
  assert.match(deploy, /EXPECTED_BACKUP_RECIPIENT_FINGERPRINT="\$\{BACKUP_GPG_RECIPIENT:\?\}"/);
});

test('deployment command does not print or forward registry or database credentials', () => {
  assert.doesNotMatch(workflow, /REGISTRY_(?:PASSWORD|TOKEN)|DATABASE_URL/);
  assert.doesNotMatch(deploy, /set -x|REGISTRY_(?:PASSWORD|TOKEN)/);
});
