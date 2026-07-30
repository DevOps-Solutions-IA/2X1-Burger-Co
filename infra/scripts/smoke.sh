#!/usr/bin/env bash
set -euo pipefail

APP_BASE_URL="${APP_BASE_URL:-http://localhost}"
API_BASE_URL="${API_BASE_URL:-${APP_BASE_URL}/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:3301}"
WAITER_BASE_URL="${WAITER_BASE_URL:-${WEB_BASE_URL}/waiter/login}"
MANIFEST_URL="${MANIFEST_URL:-${WEB_BASE_URL}/manifest.webmanifest}"
API_VERSION_URL="${API_VERSION_URL:-${API_BASE_URL}/version}"
WEB_VERSION_URL="${WEB_VERSION_URL:-${WEB_BASE_URL}/version}"

echo "Checking API health at ${API_BASE_URL}/health"
curl --fail --silent --show-error "${API_BASE_URL}/health" >/dev/null

echo "Checking web login at ${WEB_BASE_URL}/login"
curl --fail --silent --show-error "${WEB_BASE_URL}/login" >/dev/null

echo "Checking waiter login at ${WAITER_BASE_URL}"
curl --fail --silent --show-error "${WAITER_BASE_URL}" >/dev/null

echo "Checking PWA manifest at ${MANIFEST_URL}"
curl --fail --silent --show-error "${MANIFEST_URL}" >/dev/null

if [[ -n "${EXPECTED_RELEASE_COMMIT:-}" ]]; then
  api_version_file="$(mktemp)"
  web_version_file="$(mktemp)"
  cleanup_version_files() { rm -f "$api_version_file" "$web_version_file"; }
  trap cleanup_version_files EXIT

  echo "Checking release identity"
  curl --fail --silent --show-error "$API_VERSION_URL" >"$api_version_file"
  curl --fail --silent --show-error "$WEB_VERSION_URL" >"$web_version_file"
  [[ "${EXPECTED_API_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]]
  [[ "${EXPECTED_WEB_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]]
  node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../release" && pwd)/verify-runtime-identity.mjs" \
    "$api_version_file" "$web_version_file" "$EXPECTED_RELEASE_COMMIT" "$EXPECTED_API_DIGEST" "$EXPECTED_WEB_DIGEST"
fi

echo "Smoke checks passed."
