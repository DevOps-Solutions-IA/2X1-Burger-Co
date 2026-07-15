#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

HEAD_COMMIT="$(git rev-parse HEAD)"
HEAD_SHORT="${HEAD_COMMIT:0:12}"
SOURCE_HASH="$({
  find apps/api/src prisma infra/testing infra/schema -type f -print0
  printf '%s\0' package.json pnpm-lock.yaml
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
rm -rf "$TEMP_DIR/prisma" "$TEMP_DIR/infra/testing"
cp -a prisma "$TEMP_DIR/prisma"
mkdir -p "$TEMP_DIR/infra"
cp -a infra/testing "$TEMP_DIR/infra/testing"
cp package.json pnpm-lock.yaml "$TEMP_DIR/"
mkdir -p "$TEMP_DIR/.release"

BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SCHEMA_COMPATIBILITY_VERSION="prisma-$(node infra/schema/migration-expectation.mjs --field latest)"
cat >"$TEMP_DIR/.release/release-manifest.json" <<EOF
{
  "application": "inventory-fastfood-system",
  "releaseVersion": "0.1.0-${HEAD_SHORT}-phase24",
  "gitCommit": "${HEAD_COMMIT}",
  "gitCommitShort": "${HEAD_SHORT}",
  "buildTimestamp": "${BUILD_TIMESTAMP}",
  "buildId": "${BUILD_ID}",
  "environment": "test",
  "artifactDigest": null,
  "apiVersion": "0.0.1",
  "schemaCompatibilityVersion": "${SCHEMA_COMPATIBILITY_VERSION}",
  "dirtyBuild": true,
  "sourceRepository": "inventory-fastfood-system",
  "sourceSnapshotHash": "${SOURCE_HASH}"
}
EOF

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
