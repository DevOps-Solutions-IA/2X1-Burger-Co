#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_REF="${1:-HEAD}"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$ROOT_DIR/.release/artifacts}"
COMMIT="$(git -C "$ROOT_DIR" rev-parse "${RELEASE_REF}^{commit}")"
EPOCH="$(git -C "$ROOT_DIR" show -s --format=%ct "$COMMIT")"
TEMP_DIR="$(mktemp -d /tmp/inventory-release-build.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT

git -C "$ROOT_DIR" archive "$COMMIT" | tar -x -C "$TEMP_DIR"
mkdir -p "$TEMP_DIR/.release"
(
  cd "$TEMP_DIR"
  RELEASE_GIT_COMMIT="$COMMIT" \
  RELEASE_DIRTY_BUILD=false \
  RELEASE_ENVIRONMENT="${RELEASE_ENVIRONMENT:-staging}" \
  SOURCE_DATE_EPOCH="$EPOCH" \
    node infra/release/generate-release-manifest.mjs
  SOURCE_DATE_EPOCH="$EPOCH" node infra/release/generate-sbom.mjs
)

BUILD_ID="$(node -p "require('$TEMP_DIR/.release/release-manifest.json').buildId")"
OUTPUT_DIR="$OUTPUT_ROOT/$BUILD_ID"
mkdir -p "$OUTPUT_DIR"
cp "$TEMP_DIR/.release/release-manifest.json" "$OUTPUT_DIR/release-manifest.json"
cp "$TEMP_DIR/.release/sbom.cdx.json" "$OUTPUT_DIR/sbom.cdx.json"

COMMON_ARGS=(
  --build-arg "OCI_REVISION=$COMMIT"
  --build-arg "OCI_CREATED=$(node -p "require('$TEMP_DIR/.release/release-manifest.json').buildTimestamp")"
  --build-arg "OCI_VERSION=$(node -p "require('$TEMP_DIR/.release/release-manifest.json').releaseVersion")"
  --build-arg "RELEASE_BUILD_ID=$BUILD_ID"
)

API_TAG="inventory-fastfood-api:$BUILD_ID"
WEB_TAG="inventory-fastfood-web:$BUILD_ID"
docker build "${COMMON_ARGS[@]}" -f "$TEMP_DIR/infra/docker/Dockerfile.api" -t "$API_TAG" "$TEMP_DIR"
docker build "${COMMON_ARGS[@]}" -f "$TEMP_DIR/infra/docker/Dockerfile.web" -t "$WEB_TAG" "$TEMP_DIR"

API_DIGEST="$(docker image inspect --format '{{.Id}}' "$API_TAG")"
WEB_DIGEST="$(docker image inspect --format '{{.Id}}' "$WEB_TAG")"
API_LABEL_COMMIT="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$API_TAG")"
WEB_LABEL_COMMIT="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$WEB_TAG")"
[[ "$API_LABEL_COMMIT" == "$COMMIT" && "$WEB_LABEL_COMMIT" == "$COMMIT" ]]

node - "$OUTPUT_DIR/artifact-record.json" "$OUTPUT_DIR/release-manifest.json" "$API_TAG" "$API_DIGEST" "$WEB_TAG" "$WEB_DIGEST" <<'NODE'
const fs = require('fs');
const [output, manifestPath, apiTag, apiDigest, webTag, webDigest] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.writeFileSync(output, JSON.stringify({
  manifest,
  api: { tag: apiTag, digest: apiDigest, immutableReference: apiDigest },
  web: { tag: webTag, digest: webDigest, immutableReference: webDigest },
}, null, 2) + '\n');
NODE

printf '%s\n' "$OUTPUT_DIR/artifact-record.json"
