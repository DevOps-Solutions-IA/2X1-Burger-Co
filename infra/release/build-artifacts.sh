#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_REF="${1:-HEAD}"
OUTPUT_ROOT="${RELEASE_OUTPUT_DIR:-$ROOT_DIR/.release/artifacts}"
TAG_SUFFIX="${RELEASE_TAG_SUFFIX:-}"
[[ "$TAG_SUFFIX" =~ ^(-[a-z0-9]{1,24})?$ ]] || { printf '[error] invalid release tag suffix\n' >&2; exit 2; }
COMMIT="$(git -C "$ROOT_DIR" rev-parse "${RELEASE_REF}^{commit}")"
EPOCH="$(git -C "$ROOT_DIR" show -s --format=%ct "$COMMIT")"
TEMP_DIR="$(mktemp -d /tmp/inventory-release-build.XXXXXX)"
trap 'rm -rf "$TEMP_DIR"' EXIT

git -C "$ROOT_DIR" archive "$COMMIT" | tar -x -C "$TEMP_DIR"
# Older rollback baselines may predate runtime-attestation helpers. They are
# build-time readers only and do not alter the archived application source.
for helper in runtime-artifact-digest.mjs generate-image-sbom.mjs; do
  if [[ ! -f "$TEMP_DIR/infra/release/$helper" ]]; then
    git -C "$ROOT_DIR" show "HEAD:infra/release/$helper" >"$TEMP_DIR/infra/release/$helper"
  fi
done
mkdir -p "$TEMP_DIR/.release"
(
  cd "$TEMP_DIR"
  RELEASE_GIT_COMMIT="$COMMIT" \
  RELEASE_DIRTY_BUILD=false \
  RELEASE_ENVIRONMENT="${RELEASE_ENVIRONMENT:-staging}" \
  SOURCE_DATE_EPOCH="$EPOCH" \
    node infra/release/generate-release-manifest.mjs
  SOURCE_DATE_EPOCH="$EPOCH" node infra/release/generate-sbom.mjs
) >"$TEMP_DIR/.release/metadata-build.log" 2>&1
find "$TEMP_DIR/.release" -exec touch -h -d "@$EPOCH" {} +

BUILD_ID="$(node -p "require('$TEMP_DIR/.release/release-manifest.json').buildId")"
RELEASE_REPRODUCIBILITY_SECRET="${RELEASE_REPRODUCIBILITY_SECRET:-}"
[[ "$RELEASE_REPRODUCIBILITY_SECRET" =~ ^[a-f0-9]{64}$ ]] || { printf '[error] invalid release reproducibility secret\n' >&2; exit 2; }
export RELEASE_REPRODUCIBILITY_SECRET
OUTPUT_DIR="$OUTPUT_ROOT/$BUILD_ID"
mkdir -p "$OUTPUT_DIR"
cp "$TEMP_DIR/.release/release-manifest.json" "$OUTPUT_DIR/release-manifest.json"
cp "$TEMP_DIR/.release/sbom.cdx.json" "$OUTPUT_DIR/sbom.cdx.json"
cp "$TEMP_DIR/.release/metadata-build.log" "$OUTPUT_DIR/metadata-build.log"

COMMON_ARGS=(
  --no-cache
  --build-arg "SOURCE_DATE_EPOCH=$EPOCH"
  --build-arg "OCI_REVISION=$COMMIT"
  --build-arg "OCI_CREATED=$(node -p "require('$TEMP_DIR/.release/release-manifest.json').buildTimestamp")"
  --build-arg "OCI_VERSION=$(node -p "require('$TEMP_DIR/.release/release-manifest.json').releaseVersion")"
  --build-arg "RELEASE_BUILD_ID=$BUILD_ID"
)
API_TAG="inventory-fastfood-api:${BUILD_ID}${TAG_SUFFIX}"
WEB_TAG="inventory-fastfood-web:${BUILD_ID}${TAG_SUFFIX}"
if ! docker build "${COMMON_ARGS[@]}" -f "$TEMP_DIR/infra/docker/Dockerfile.api" -t "$API_TAG" "$TEMP_DIR" \
  >"$OUTPUT_DIR/api-build.log" 2>&1; then
  cat "$OUTPUT_DIR/api-build.log" >&2
  exit 1
fi
if ! docker build "${COMMON_ARGS[@]}" --secret id=release_reproducibility_secret,env=RELEASE_REPRODUCIBILITY_SECRET \
  -f "$TEMP_DIR/infra/docker/Dockerfile.web" -t "$WEB_TAG" "$TEMP_DIR" \
  >"$OUTPUT_DIR/web-build.log" 2>&1; then
  cat "$OUTPUT_DIR/web-build.log" >&2
  exit 1
fi

API_DIGEST="$(docker image inspect --format '{{.Id}}' "$API_TAG")"
WEB_DIGEST="$(docker image inspect --format '{{.Id}}' "$WEB_TAG")"
docker image inspect "$API_TAG" >"$OUTPUT_DIR/api-image-inspect.json"
docker image inspect "$WEB_TAG" >"$OUTPUT_DIR/web-image-inspect.json"
API_CONTENT_DIGEST="$(docker run --rm --network none --entrypoint node \
  -v "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs:/tmp/runtime-artifact-digest.mjs:ro" \
  "$API_TAG" /tmp/runtime-artifact-digest.mjs filesystem /app)"
WEB_CONTENT_DIGEST="$(docker run --rm --network none --entrypoint node \
  -v "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs:/tmp/runtime-artifact-digest.mjs:ro" \
  "$WEB_TAG" /tmp/runtime-artifact-digest.mjs filesystem /app)"
API_CONFIG_DIGEST="$(node "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs" config "$OUTPUT_DIR/api-image-inspect.json")"
WEB_CONFIG_DIGEST="$(node "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs" config "$OUTPUT_DIR/web-image-inspect.json")"
API_ROOTFS_DIGEST="$(node "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs" rootfs "$OUTPUT_DIR/api-image-inspect.json")"
WEB_ROOTFS_DIGEST="$(node "$TEMP_DIR/infra/release/runtime-artifact-digest.mjs" rootfs "$OUTPUT_DIR/web-image-inspect.json")"
docker run --rm --network none --entrypoint node \
  -v "$TEMP_DIR/infra/release/generate-image-sbom.mjs:/tmp/generate-image-sbom.mjs:ro" \
  "$API_TAG" /tmp/generate-image-sbom.mjs api "$COMMIT" >"$OUTPUT_DIR/api-sbom.cdx.json"
docker run --rm --network none --entrypoint node \
  -v "$TEMP_DIR/infra/release/generate-image-sbom.mjs:/tmp/generate-image-sbom.mjs:ro" \
  "$WEB_TAG" /tmp/generate-image-sbom.mjs web "$COMMIT" >"$OUTPUT_DIR/web-sbom.cdx.json"
API_SBOM_DIGEST="sha256:$(sha256sum "$OUTPUT_DIR/api-sbom.cdx.json" | cut -d' ' -f1)"
WEB_SBOM_DIGEST="sha256:$(sha256sum "$OUTPUT_DIR/web-sbom.cdx.json" | cut -d' ' -f1)"
docker save "$API_TAG" | gzip -n >"$OUTPUT_DIR/api-image.tar.gz"
docker save "$WEB_TAG" | gzip -n >"$OUTPUT_DIR/web-image.tar.gz"
API_ARCHIVE_DIGEST="sha256:$(sha256sum "$OUTPUT_DIR/api-image.tar.gz" | cut -d' ' -f1)"
WEB_ARCHIVE_DIGEST="sha256:$(sha256sum "$OUTPUT_DIR/web-image.tar.gz" | cut -d' ' -f1)"
rm -f "$OUTPUT_DIR/api-image-inspect.json" "$OUTPUT_DIR/web-image-inspect.json"
API_LABEL_COMMIT="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$API_TAG")"
WEB_LABEL_COMMIT="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$WEB_TAG")"
[[ "$API_LABEL_COMMIT" == "$COMMIT" && "$WEB_LABEL_COMMIT" == "$COMMIT" ]]
EXPECTED_MIGRATIONS="$(node -p "require('$OUTPUT_DIR/release-manifest.json').schemaMigrationCount")"
docker run --rm --network none --entrypoint sh "$API_TAG" -lc \
  'test "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq "$1" && test ! -e /app/.git && test ! -e /app/.env' \
  _ "$EXPECTED_MIGRATIONS"
docker run --rm --network none --entrypoint sh "$WEB_TAG" -lc 'test ! -e /app/.git && test ! -e /app/.env'
[[ "$(docker image inspect --format '{{.Config.User}}' "$API_TAG")" == node ]]
[[ "$(docker image inspect --format '{{.Config.User}}' "$WEB_TAG")" == node ]]

node - "$OUTPUT_DIR/artifact-record.json" "$OUTPUT_DIR/release-manifest.json" \
  "$API_TAG" "$API_DIGEST" "$API_CONTENT_DIGEST" "$API_CONFIG_DIGEST" \
  "$API_ROOTFS_DIGEST" "$API_SBOM_DIGEST" "$API_ARCHIVE_DIGEST" \
  "$WEB_TAG" "$WEB_DIGEST" "$WEB_CONTENT_DIGEST" "$WEB_CONFIG_DIGEST" \
  "$WEB_ROOTFS_DIGEST" "$WEB_SBOM_DIGEST" "$WEB_ARCHIVE_DIGEST" <<'NODE'
const fs = require('fs');
const [output, manifestPath, apiTag, apiDigest, apiContentDigest, apiConfigDigest, apiRootfsDigest, apiSbomDigest, apiArchiveDigest, webTag, webDigest, webContentDigest, webConfigDigest, webRootfsDigest, webSbomDigest, webArchiveDigest] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.writeFileSync(output, JSON.stringify({
  manifest,
  provenance: { type: 'local-image-config-rootfs', registryManifestDigest: null, registryPushAuthorized: false },
  api: { tag: apiTag, digest: apiDigest, localImageConfigDigest: apiDigest, contentDigest: apiContentDigest, configDigest: apiConfigDigest, rootfsDigest: apiRootfsDigest, sbomDigest: apiSbomDigest, archiveDigest: apiArchiveDigest, archive: 'api-image.tar.gz', migrationCount: manifest.schemaMigrationCount },
  web: { tag: webTag, digest: webDigest, localImageConfigDigest: webDigest, contentDigest: webContentDigest, configDigest: webConfigDigest, rootfsDigest: webRootfsDigest, sbomDigest: webSbomDigest, archiveDigest: webArchiveDigest, archive: 'web-image.tar.gz' },
}, null, 2) + '\n');
NODE

printf '%s\n' "$OUTPUT_DIR/artifact-record.json"
