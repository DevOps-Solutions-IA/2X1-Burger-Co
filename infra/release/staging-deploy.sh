#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ -n "${STAGING_PATH:-}" && -d "$STAGING_PATH" ]]
[[ "$STAGING_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$STAGING_PATH" != *".."* ]]

fail() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

cd "$STAGING_PATH"
[[ "$(git rev-parse HEAD)" == "${RELEASE_COMMIT:-}" ]] || fail "Staging checkout does not match the authorized release commit."
git diff --quiet && git diff --cached --quiet || fail "Staging checkout has tracked changes."
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "Staging checkout is not clean."
source "$STAGING_PATH/infra/scripts/common.sh"

validate_image_reference "${API_IMAGE:-}"
validate_image_reference "${WEB_IMAGE:-}"
[[ "${RELEASE_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "${ALLOWED_API_IMAGE_REPOSITORY:-}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)+$ ]]
[[ "${ALLOWED_WEB_IMAGE_REPOSITORY:-}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)+$ ]]
[[ "$ALLOWED_API_IMAGE_REPOSITORY" != "$ALLOWED_WEB_IMAGE_REPOSITORY" ]]
[[ "${API_IMAGE%@sha256:*}" == "$ALLOWED_API_IMAGE_REPOSITORY" ]]
[[ "${WEB_IMAGE%@sha256:*}" == "$ALLOWED_WEB_IMAGE_REPOSITORY" ]]

validate_root_owned_config_file() {
  local file_path="$1"
  local description="$2"
  local mode

  [[ "$file_path" =~ ^/[A-Za-z0-9._/-]+$ && "$file_path" != *".."* ]] \
    || fail "$description path is invalid."
  [[ -f "$file_path" && ! -L "$file_path" ]] || fail "$description must be a regular non-symlink file."
  [[ "$(stat -c '%u' "$file_path")" == "0" ]] || fail "$description must be owned by root."
  mode="$(stat -c '%a' "$file_path")"
  (( (8#$mode & 8#022) == 0 )) || fail "$description must not be writable by group or other users."
}

validate_root_owned_secret_file() {
  local file_path="$1"
  local description="$2"
  validate_root_owned_config_file "$file_path" "$description"
  [[ "$(stat -c '%a' "$file_path")" == "600" ]] \
    || fail "$description must have mode 600."
}

STAGING_PROTECTED_CONFIG_PATH="${STAGING_PROTECTED_CONFIG_PATH:-}"
COSIGN_VERIFICATION_KEY_PATH="${COSIGN_VERIFICATION_KEY_PATH:-}"
ARTIFACT_SIGNING_KEY_FINGERPRINT="${ARTIFACT_SIGNING_KEY_FINGERPRINT:-}"
EXPECTED_SLSA_BUILDER_ID="${EXPECTED_SLSA_BUILDER_ID:-}"
EXPECTED_SOURCE_REPOSITORY="${EXPECTED_SOURCE_REPOSITORY:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
BACKUP_GPG_SIGNING_FINGERPRINT="${BACKUP_GPG_SIGNING_FINGERPRINT:-}"
BACKUP_GNUPGHOME="${BACKUP_GNUPGHOME:-}"
BACKUP_DATABASE_IDENTITY_HASH="${BACKUP_DATABASE_IDENTITY_HASH:-}"

validate_root_owned_secret_file "$STAGING_PROTECTED_CONFIG_PATH" "Protected staging runtime configuration"
validate_root_owned_config_file "$COSIGN_VERIFICATION_KEY_PATH" "Cosign verification key"
[[ "$(realpath "$STAGING_PROTECTED_CONFIG_PATH")" != "$(realpath "$STAGING_PATH")" && \
   "$(realpath "$STAGING_PROTECTED_CONFIG_PATH")" != "$(realpath "$STAGING_PATH")/"* ]] \
  || fail "Protected staging runtime configuration must remain outside the checkout."
[[ "$(realpath "$COSIGN_VERIFICATION_KEY_PATH")" != "$(realpath "$STAGING_PATH")" && \
   "$(realpath "$COSIGN_VERIFICATION_KEY_PATH")" != "$(realpath "$STAGING_PATH")/"* ]] \
  || fail "Cosign verification key must remain outside the checkout."
[[ "$ARTIFACT_SIGNING_KEY_FINGERPRINT" =~ ^sha256:[a-f0-9]{64}$ ]] \
  || fail "Artifact signing key fingerprint is required."
[[ "sha256:$(sha256sum "$COSIGN_VERIFICATION_KEY_PATH" | awk '{print $1}')" == "$ARTIFACT_SIGNING_KEY_FINGERPRINT" ]] \
  || fail "Cosign verification key does not match the protected fingerprint."
[[ "$EXPECTED_SLSA_BUILDER_ID" =~ ^[A-Za-z0-9:/@._+-]{3,512}$ ]] \
  || fail "Expected SLSA builder identity is invalid."
[[ "$EXPECTED_SOURCE_REPOSITORY" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] \
  || fail "Expected source repository is invalid."
[[ "$BACKUP_GPG_RECIPIENT" =~ ^[A-F0-9]{40}$ ]] || fail "Backup GPG recipient fingerprint is invalid."
[[ "$BACKUP_GPG_SIGNING_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]] \
  || fail "Backup GPG signing fingerprint is invalid."
[[ "$BACKUP_DATABASE_IDENTITY_HASH" =~ ^sha256:[a-f0-9]{64}$ ]] \
  || fail "Independent backup database identity hash is invalid."
[[ "$BACKUP_GNUPGHOME" =~ ^/[A-Za-z0-9._/-]+$ && "$BACKUP_GNUPGHOME" != *".."* && \
   -d "$BACKUP_GNUPGHOME" && ! -L "$BACKUP_GNUPGHOME" ]] \
  || fail "Backup GNUPGHOME must be an absolute protected directory."
[[ "$(stat -c '%a' "$BACKUP_GNUPGHOME")" == "700" ]] || fail "Backup GNUPGHOME must have mode 700."
[[ "$(stat -c '%u' "$BACKUP_GNUPGHOME")" == "$(id -u)" ]] \
  || fail "Backup GNUPGHOME must be owned by the staging deployment user."
if grep -Eq '^[[:space:]]*(BACKUP_SOURCE_SHA|BACKUP_ENVIRONMENT|BACKUP_GPG_RECIPIENT|BACKUP_GPG_SIGNING_FINGERPRINT|GNUPGHOME|REQUIRE_BACKUP_METADATA_V2|EXPECTED_SOURCE_SHA|EXPECTED_BACKUP_[A-Z0-9_]+)[[:space:]]*=' \
  "$STAGING_PROTECTED_CONFIG_PATH"; then
  fail "Protected release controls must not be overridden by the runtime environment file."
fi

command -v cosign >/dev/null 2>&1 || fail "cosign is required for artifact trust verification."
command -v gpg >/dev/null 2>&1 || fail "gpg is required for backup authenticity verification."
RESOLVED_BACKUP_RECIPIENT="$(GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --with-colons \
  --list-keys -- "$BACKUP_GPG_RECIPIENT" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$RESOLVED_BACKUP_RECIPIENT" == "$BACKUP_GPG_RECIPIENT" ]] \
  || fail "Backup GNUPGHOME does not contain the configured recipient."
RESOLVED_BACKUP_SIGNER="$(GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --with-colons \
  --list-secret-keys -- "$BACKUP_GPG_SIGNING_FINGERPRINT" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$RESOLVED_BACKUP_SIGNER" == "$BACKUP_GPG_SIGNING_FINGERPRINT" ]] \
  || fail "Backup GNUPGHOME does not contain the configured signing secret key."

API_DIGEST="${API_IMAGE##*@}"
WEB_DIGEST="${WEB_IMAGE##*@}"

test -x ./infra/scripts/backup.sh
test -x ./infra/scripts/restore.sh
test -x ./infra/scripts/smoke.sh

STATE_DIR="${STAGING_RELEASE_STATE_DIR:-${STAGING_PATH%/}-release-state}"
[[ "$STATE_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$STATE_DIR" != *".."* ]] || fail "Invalid staging release state path."
[[ "$STATE_DIR" != "$STAGING_PATH" && "$STATE_DIR" != "$STAGING_PATH/"* ]] \
  || fail "Release state must be outside the clean staging checkout."
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
[[ ! -L "$STATE_DIR" ]] || fail "Release state directory must not be a symbolic link."
[[ "$(realpath "$STATE_DIR")" != "$(realpath "$STAGING_PATH")" && \
   "$(realpath "$STATE_DIR")" != "$(realpath "$STAGING_PATH")/"* ]] \
  || fail "Release state resolves inside the staging checkout."

read_release_state() {
  local state_file="$1"
  local marker_file="$2"
  local expected_hash actual_hash line_count

  [[ -f "$state_file" && ! -L "$state_file" ]] || fail "A validated rollback baseline is required."
  [[ -f "$marker_file" && ! -L "$marker_file" ]] || fail "Rollback baseline attestation is missing."
  line_count="$(awk 'NF { count += 1 } END { print count + 0 }' "$state_file")"
  [[ "$line_count" == "3" ]] || fail "Rollback baseline state is malformed."
  BASELINE_API_IMAGE="$(sed -n 's/^API_IMAGE=//p' "$state_file")"
  BASELINE_WEB_IMAGE="$(sed -n 's/^WEB_IMAGE=//p' "$state_file")"
  BASELINE_RELEASE_COMMIT="$(sed -n 's/^RELEASE_COMMIT=//p' "$state_file")"
  [[ "$(grep -c '^API_IMAGE=' "$state_file")" == "1" ]]
  [[ "$(grep -c '^WEB_IMAGE=' "$state_file")" == "1" ]]
  [[ "$(grep -c '^RELEASE_COMMIT=' "$state_file")" == "1" ]]
  validate_image_reference "$BASELINE_API_IMAGE"
  validate_image_reference "$BASELINE_WEB_IMAGE"
  [[ "$BASELINE_RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]
  [[ "${BASELINE_API_IMAGE%@sha256:*}" == "$ALLOWED_API_IMAGE_REPOSITORY" ]]
  [[ "${BASELINE_WEB_IMAGE%@sha256:*}" == "$ALLOWED_WEB_IMAGE_REPOSITORY" ]]
  expected_hash="$(cat "$marker_file")"
  [[ "$expected_hash" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "Rollback baseline attestation is malformed."
  actual_hash="sha256:$(sha256sum "$state_file" | awk '{print $1}')"
  [[ "$actual_hash" == "$expected_hash" ]] || fail "Rollback baseline attestation does not match its state."
}

write_release_state() {
  local state_file="$1"
  local marker_file="$2"
  local api_image="$3"
  local web_image="$4"
  local release_commit="$5"

  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nRELEASE_COMMIT=%s\n' \
    "$api_image" "$web_image" "$release_commit" >"$state_file"
  printf 'sha256:%s\n' "$(sha256sum "$state_file" | awk '{print $1}')" >"$marker_file"
  chmod 600 "$state_file" "$marker_file"
}

ARTIFACT_VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inventory-staging-artifacts.XXXXXX")"
VERIFY_CONTAINERS=()
cleanup_artifact_verification() {
  local container
  for container in "${VERIFY_CONTAINERS[@]:-}"; do
    [[ -z "$container" ]] || docker rm -f "$container" >/dev/null 2>&1 || true
  done
  rm -rf "$ARTIFACT_VERIFY_DIR"
}
trap cleanup_artifact_verification EXIT

verify_attestation_contract() {
  local statement_file="$1"
  local expected_digest="$2"
  local expected_type="$3"
  local expected_commit="$4"

  node - "$statement_file" "$expected_digest" "$expected_type" "$expected_commit" \
    "$EXPECTED_SLSA_BUILDER_ID" "$EXPECTED_SOURCE_REPOSITORY" <<'NODE'
const fs = require('node:fs');
const [file, expectedDigest, expectedType, expectedCommit, expectedBuilder, expectedSource] = process.argv.slice(2);
const raw = fs.readFileSync(file, 'utf8').trim();
if (!raw || raw.length > 4 * 1024 * 1024) throw new Error('Attestation output is empty or unbounded');
const parseDocuments = (input) => {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const documents = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') {
        if (depth === 0) start = index;
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth < 0) throw new Error('Malformed attestation JSON stream');
        if (depth === 0 && start >= 0) {
          documents.push(JSON.parse(input.slice(start, index + 1)));
          start = -1;
        }
      }
    }
    if (depth !== 0 || inString || documents.length === 0) throw new Error('Malformed attestation JSON stream');
    return documents;
  }
};
const records = parseDocuments(raw);
const statements = records.map((record) => JSON.parse(Buffer.from(record.payload, 'base64').toString('utf8')));
const subjectMatches = (statement) => statement.subject?.some((subject) => subject.digest?.sha256 === expectedDigest);
const sourceMatches = (value) => {
  const normalized = value.replace(/^git\+/u, '').replace(/\.git(?=@|#|$)/u, '');
  return normalized === expectedSource || normalized.startsWith(`${expectedSource}@`) || normalized.startsWith(`${expectedSource}#`);
};
const hasBoundSource = (value) => {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.uri === 'string' && sourceMatches(value.uri) && value.digest &&
      Object.values(value.digest).some((digest) => digest === expectedCommit)) return true;
  return Object.values(value).some((entry) => Array.isArray(entry)
    ? entry.some(hasBoundSource)
    : hasBoundSource(entry));
};
const valid = statements.some((statement) => {
  if (!subjectMatches(statement)) return false;
  if (expectedType === 'cyclonedx') {
    return statement.predicateType === 'https://cyclonedx.org/bom' &&
      statement.predicate?.bomFormat === 'CycloneDX' &&
      Array.isArray(statement.predicate?.components);
  }
  const predicate = statement.predicate ?? {};
  const builderId = predicate.runDetails?.builder?.id ?? predicate.builder?.id;
  return /^https:\/\/slsa\.dev\/provenance\/v(?:0\.2|1)$/u.test(statement.predicateType ?? '') &&
    builderId === expectedBuilder && hasBoundSource(predicate);
});
if (!valid) throw new Error(`No ${expectedType} attestation satisfied the protected release contract`);
NODE
}

verify_external_artifact() {
  local image="$1"
  local expected_commit="$2"
  local slot="$3"
  local digest="${image##*@sha256:}"
  local signature_output="$ARTIFACT_VERIFY_DIR/${slot}-signature.json"
  local sbom_output="$ARTIFACT_VERIFY_DIR/${slot}-sbom-attestation.json"
  local provenance_output="$ARTIFACT_VERIFY_DIR/${slot}-provenance-attestation.json"

  cosign verify --key "$COSIGN_VERIFICATION_KEY_PATH" "$image" >"$signature_output"
  cosign verify-attestation --key "$COSIGN_VERIFICATION_KEY_PATH" --type cyclonedx \
    "$image" >"$sbom_output"
  cosign verify-attestation --key "$COSIGN_VERIFICATION_KEY_PATH" --type slsaprovenance \
    "$image" >"$provenance_output"
  verify_attestation_contract "$sbom_output" "$digest" cyclonedx "$expected_commit"
  verify_attestation_contract "$provenance_output" "$digest" slsaprovenance "$expected_commit"
}

verify_release_image() {
  local image="$1"
  local role="$2"
  local expected_commit="$3"
  local slot="$4"
  local output_file="$ARTIFACT_VERIFY_DIR/${slot}-${role}.json"
  local expected_title label_revision label_source label_title container

  case "$role" in
    api) expected_title="2X1 Burger Co API" ;;
    web) expected_title="2X1 Burger Co Web" ;;
    *) fail "Unsupported artifact role." ;;
  esac

  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -Fx -- "$image" >/dev/null \
    || fail "Pulled artifact digest does not match its immutable reference."
  label_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  label_source="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")"
  label_title="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "$image")"
  [[ "$label_revision" == "$expected_commit" ]] || fail "Artifact revision label does not match the release commit."
  [[ "$label_source" == "inventory-fastfood-system" ]] || fail "Artifact source label is invalid."
  [[ "$label_title" == "$expected_title" ]] || fail "Artifact role label is invalid."

  # Extract only: the unverified image is never started or given network, mounts, secrets, or DB access.
  container="$(docker create --network none --entrypoint /bin/false "$image")"
  VERIFY_CONTAINERS+=("$container")
  if ! docker cp "$container:/app/release-manifest.json" "$output_file"; then
    fail "Artifact release manifest is unavailable."
  fi
  docker rm "$container" >/dev/null
  [[ "$(wc -c <"$output_file")" -le 131072 ]] || fail "Artifact release manifest is too large."

  node - "$output_file" "$expected_commit" "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)" <<'NODE'
const fs = require('node:fs');
const [file, expectedCommit, expectedMigrationCountText] = process.argv.slice(2);
const expectedMigrationCount = Number(expectedMigrationCountText.trim());
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const safetyFlags = manifest.safetyFlags ?? {};
const valid =
  manifest.releaseManifestVersion === 1 &&
  manifest.application === 'inventory-fastfood-system' &&
  manifest.sourceRepository === 'inventory-fastfood-system' &&
  manifest.commitSha === expectedCommit &&
  manifest.gitCommit === expectedCommit &&
  manifest.environment === 'staging' &&
  manifest.dirtyBuild === false &&
  manifest.artifactDigest === null &&
  manifest.schemaMigrationCount === expectedMigrationCount &&
  manifest.migrationCount === expectedMigrationCount &&
  Array.isArray(manifest.migrationInventory) &&
  manifest.migrationInventory.length === expectedMigrationCount &&
  manifest.schemaVersion === manifest.migrationInventory.at(-1)?.name &&
  safetyFlags.realSendingEnabled === false &&
  safetyFlags.autoReplyEnabled === false &&
  safetyFlags.autoSafeEnabled === false &&
  safetyFlags.productionEnabled === false &&
  safetyFlags.whatsappCanMarkPaid === false;
if (!valid) throw new Error('Artifact release manifest failed the staging contract');
NODE
}

read_release_state "$STATE_DIR/current.env" "$STATE_DIR/current.validated"

# External signatures and attestations are verified before pulling or exposing backup/DB access.
verify_external_artifact "$API_IMAGE" "$RELEASE_COMMIT" candidate-api
verify_external_artifact "$WEB_IMAGE" "$RELEASE_COMMIT" candidate-web
verify_external_artifact "$BASELINE_API_IMAGE" "$BASELINE_RELEASE_COMMIT" baseline-api
verify_external_artifact "$BASELINE_WEB_IMAGE" "$BASELINE_RELEASE_COMMIT" baseline-web
docker pull "$API_IMAGE" >/dev/null
docker pull "$WEB_IMAGE" >/dev/null
docker pull "$BASELINE_API_IMAGE" >/dev/null
docker pull "$BASELINE_WEB_IMAGE" >/dev/null
verify_release_image "$API_IMAGE" api "$RELEASE_COMMIT" candidate
verify_release_image "$WEB_IMAGE" web "$RELEASE_COMMIT" candidate
verify_release_image "$BASELINE_API_IMAGE" api "$BASELINE_RELEASE_COMMIT" baseline
verify_release_image "$BASELINE_WEB_IMAGE" web "$BASELINE_RELEASE_COMMIT" baseline
cmp -s "$ARTIFACT_VERIFY_DIR/candidate-api.json" "$ARTIFACT_VERIFY_DIR/candidate-web.json" \
  || fail "API and Web release manifests do not describe the same release."
cmp -s "$ARTIFACT_VERIFY_DIR/baseline-api.json" "$ARTIFACT_VERIFY_DIR/baseline-web.json" \
  || fail "Rollback API and Web manifests do not describe the same release."

STAGING_BACKUP_DIR="${STAGING_BACKUP_DIR:-$STATE_DIR/backups}"
[[ "$STAGING_BACKUP_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$STAGING_BACKUP_DIR" != *".."* ]] \
  || fail "Invalid staging backup path."
[[ "$STAGING_BACKUP_DIR" != "$STAGING_PATH" && "$STAGING_BACKUP_DIR" != "$STAGING_PATH/"* ]] \
  || fail "Staging backups must be stored outside the clean checkout."
mkdir -p "$STAGING_BACKUP_DIR"
[[ ! -L "$STAGING_BACKUP_DIR" ]] || fail "Staging backup directory must not be a symbolic link."
[[ "$(realpath "$STAGING_BACKUP_DIR")" != "$(realpath "$STAGING_PATH")" && \
   "$(realpath "$STAGING_BACKUP_DIR")" != "$(realpath "$STAGING_PATH")/"* ]] \
  || fail "Staging backup directory resolves inside the clean checkout."
BACKUP_OUTPUT="$(
  RUNTIME_ENV_FILE="$STAGING_PROTECTED_CONFIG_PATH" \
  BACKUP_DIR="$STAGING_BACKUP_DIR" \
  BACKUP_SOURCE_SHA="$BASELINE_RELEASE_COMMIT" \
  BACKUP_ENVIRONMENT=staging \
  BACKUP_GPG_RECIPIENT="$BACKUP_GPG_RECIPIENT" \
  BACKUP_GPG_SIGNING_FINGERPRINT="$BACKUP_GPG_SIGNING_FINGERPRINT" \
  BACKUP_SIGNING_GNUPGHOME="$BACKUP_GNUPGHOME" \
  GNUPGHOME="$BACKUP_GNUPGHOME" \
    ./infra/scripts/backup.sh
)"
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^\[info\] Backup stored at //p' | tail -n 1)"
[[ -n "$BACKUP_FILE" && "$BACKUP_FILE" == *.dump.gpg && -f "$BACKUP_FILE" ]]
[[ "$(realpath "$BACKUP_FILE")" == "$(realpath "$STAGING_BACKUP_DIR")/"* ]] \
  || fail "Backup script did not use the isolated staging backup directory."
for backup_evidence in "$BACKUP_FILE" "${BACKUP_FILE}.sha256" \
  "${BACKUP_FILE}.sig" "${BACKUP_FILE}.metadata.json" \
  "${BACKUP_FILE}.metadata.json.sha256" "${BACKUP_FILE}.metadata.json.sig"; do
  [[ -f "$backup_evidence" && ! -L "$backup_evidence" ]] || fail "Backup evidence is incomplete."
done
REQUIRE_BACKUP_METADATA_V2=true \
EXPECTED_BACKUP_SOURCE_SHA="$BASELINE_RELEASE_COMMIT" \
EXPECTED_BACKUP_RECIPIENT_FINGERPRINT="$BACKUP_GPG_RECIPIENT" \
EXPECTED_BACKUP_SIGNING_FINGERPRINT="$BACKUP_GPG_SIGNING_FINGERPRINT" \
EXPECTED_BACKUP_ENVIRONMENT=staging \
EXPECTED_BACKUP_DATABASE_IDENTITY_HASH="$BACKUP_DATABASE_IDENTITY_HASH" \
BACKUP_SIGNING_GNUPGHOME="$BACKUP_GNUPGHOME" \
GNUPGHOME="$BACKUP_GNUPGHOME" \
RUNTIME_ENV_FILE="$STAGING_PROTECTED_CONFIG_PATH" \
  ./infra/scripts/restore.sh "$BACKUP_FILE" --validate-only

write_release_state "$STATE_DIR/candidate.env" "$STATE_DIR/candidate.validated" \
  "$API_IMAGE" "$WEB_IMAGE" "$RELEASE_COMMIT"

API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" API_DIGEST="$API_DIGEST" WEB_DIGEST="$WEB_DIGEST" \
  docker compose --env-file "$STAGING_PROTECTED_CONFIG_PATH" \
  -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml run --rm --no-deps api \
  sh -lc './node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'

rollback_to_baseline() {
  local baseline_api_digest="${BASELINE_API_IMAGE##*@}"
  local baseline_web_digest="${BASELINE_WEB_IMAGE##*@}"

  rm -f "$STATE_DIR/candidate.env" "$STATE_DIR/candidate.validated"
  API_IMAGE="$BASELINE_API_IMAGE" WEB_IMAGE="$BASELINE_WEB_IMAGE" \
    API_DIGEST="$baseline_api_digest" WEB_DIGEST="$baseline_web_digest" \
    docker compose --env-file "$STAGING_PROTECTED_CONFIG_PATH" \
    -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx
  EXPECTED_RELEASE_COMMIT="$BASELINE_RELEASE_COMMIT" \
    EXPECTED_API_DIGEST="$baseline_api_digest" EXPECTED_WEB_DIGEST="$baseline_web_digest" \
    ./infra/scripts/smoke.sh
}

if ! API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" API_DIGEST="$API_DIGEST" WEB_DIGEST="$WEB_DIGEST" \
  docker compose --env-file "$STAGING_PROTECTED_CONFIG_PATH" \
  -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx; then
  rollback_to_baseline
  fail "Candidate startup failed; the validated baseline was restored."
fi

if EXPECTED_RELEASE_COMMIT="$RELEASE_COMMIT" EXPECTED_API_DIGEST="$API_DIGEST" EXPECTED_WEB_DIGEST="$WEB_DIGEST" \
  ./infra/scripts/smoke.sh; then
  mv "$STATE_DIR/current.env" "$STATE_DIR/previous.env"
  mv "$STATE_DIR/current.validated" "$STATE_DIR/previous.validated"
  mv "$STATE_DIR/candidate.env" "$STATE_DIR/current.env"
  mv "$STATE_DIR/candidate.validated" "$STATE_DIR/current.validated"
else
  rollback_to_baseline
  exit 1
fi
