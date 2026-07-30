#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

HEAD_COMMIT="$(git rev-parse HEAD)"
HEAD_SHORT="${HEAD_COMMIT:0:12}"
HEAD_EPOCH="$(git show -s --format=%ct "$HEAD_COMMIT")"
SOURCE_HASH="$({
  find apps/api/src apps/web/src prisma infra/testing infra/schema infra/release infra/recovery infra/docker infra/scripts -type f -print0
  printf '%s\0' package.json pnpm-lock.yaml apps/api/package.json apps/web/package.json apps/web/next.config.ts
} | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)"
BUILD_ID="0.1.0-${HEAD_SHORT}-phase24-${SOURCE_HASH}"
API_TAG="inventory-fastfood-api:${BUILD_ID}"
WEB_TAG="inventory-fastfood-web:${BUILD_ID}"
OUTPUT_DIR="${RECOVERY_ARTIFACT_DIR:-/tmp/inventory-phase-2-4-artifacts}/${BUILD_ID}"
RECORD="$OUTPUT_DIR/artifact-record.json"

mkdir -p "$OUTPUT_DIR"
chmod 700 "$(dirname "$OUTPUT_DIR")" "$OUTPUT_DIR"

if docker image inspect "$API_TAG" "$WEB_TAG" >/dev/null 2>&1 && [[ -f "$RECORD" ]]; then
  printf '%s\n' "$RECORD"
  exit 0
fi

TEMP_DIR="$(mktemp -d /tmp/inventory-phase24-build.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT
git archive "$HEAD_COMMIT" | tar -x -C "$TEMP_DIR"
rm -rf "$TEMP_DIR/apps/api/src"
cp -a apps/api/src "$TEMP_DIR/apps/api/src"
rm -rf "$TEMP_DIR/apps/web/src"
cp -a apps/web/src "$TEMP_DIR/apps/web/src"
cp apps/api/package.json "$TEMP_DIR/apps/api/package.json"
cp apps/web/package.json apps/web/next.config.ts "$TEMP_DIR/apps/web/"
rm -rf "$TEMP_DIR/prisma" "$TEMP_DIR/infra/testing" "$TEMP_DIR/infra/schema" "$TEMP_DIR/infra/release" \
  "$TEMP_DIR/infra/recovery" "$TEMP_DIR/infra/docker" "$TEMP_DIR/infra/scripts"
cp -a prisma "$TEMP_DIR/prisma"
mkdir -p "$TEMP_DIR/infra"
for directory in testing schema release recovery docker scripts; do
  cp -a "infra/$directory" "$TEMP_DIR/infra/$directory"
done
cp package.json pnpm-lock.yaml "$TEMP_DIR/"
mkdir -p "$TEMP_DIR/.release"

BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
(
  cd "$TEMP_DIR"
  RELEASE_GIT_COMMIT="$HEAD_COMMIT" RELEASE_DIRTY_BUILD=true RELEASE_ENVIRONMENT=test SOURCE_DATE_EPOCH="$HEAD_EPOCH" \
    node infra/release/generate-release-manifest.mjs >/dev/null
)
node - "$TEMP_DIR/.release/release-manifest.json" "$BUILD_ID" "$SOURCE_HASH" "$BUILD_TIMESTAMP" <<'NODE'
const fs = require('node:fs');
const [file, buildId, sourceSnapshotHash, buildTimestamp] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.releaseVersion = `${manifest.releaseVersion}-phase24`;
manifest.buildId = buildId;
manifest.frontendBuildId = buildId;
manifest.backendBuildId = buildId;
manifest.buildTimestamp = buildTimestamp;
manifest.generatedAt = buildTimestamp;
manifest.sourceSnapshotHash = sourceSnapshotHash;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

common_args=(
  --build-arg "OCI_REVISION=$HEAD_COMMIT"
  --build-arg "OCI_CREATED=$BUILD_TIMESTAMP"
  --build-arg "OCI_VERSION=0.1.0-${HEAD_SHORT}-phase24"
  --build-arg "RELEASE_BUILD_ID=$BUILD_ID"
)
if ! docker build "${common_args[@]}" -f "$TEMP_DIR/infra/docker/Dockerfile.api" -t "$API_TAG" "$TEMP_DIR" \
  >"$OUTPUT_DIR/api-build.log" 2>&1; then
  cat "$OUTPUT_DIR/api-build.log" >&2
  exit 1
fi
if ! docker build "${common_args[@]}" -f "$TEMP_DIR/infra/docker/Dockerfile.web" -t "$WEB_TAG" "$TEMP_DIR" \
  >"$OUTPUT_DIR/web-build.log" 2>&1; then
  cat "$OUTPUT_DIR/web-build.log" >&2
  exit 1
fi

API_DIGEST="$(docker image inspect --format '{{.Id}}' "$API_TAG")"
WEB_DIGEST="$(docker image inspect --format '{{.Id}}' "$WEB_TAG")"
cp "$TEMP_DIR/.release/release-manifest.json" "$OUTPUT_DIR/release-manifest.json"
chmod 600 "$OUTPUT_DIR/release-manifest.json"

node - "$RECORD" "$OUTPUT_DIR/release-manifest.json" "$API_TAG" "$API_DIGEST" "$WEB_TAG" "$WEB_DIGEST" <<'NODE'
const fs = require('node:fs');
const [output, manifestPath, apiTag, apiDigest, webTag, webDigest] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.writeFileSync(output, `${JSON.stringify({
  manifest,
  api: { tag: apiTag, digest: apiDigest },
  web: { tag: webTag, digest: webDigest },
  productionEligible: false,
}, null, 2)}\n`, { mode: 0o600 });
NODE

printf '%s\n' "$RECORD"
