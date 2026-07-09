#!/usr/bin/env bash
set -euo pipefail

APP_BASE_URL="${APP_BASE_URL:-http://localhost}"
API_BASE_URL="${API_BASE_URL:-${APP_BASE_URL}/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:3301}"
WAITER_BASE_URL="${WAITER_BASE_URL:-${WEB_BASE_URL}/waiter/login}"
MANIFEST_URL="${MANIFEST_URL:-${WEB_BASE_URL}/manifest.webmanifest}"

echo "Checking API health at ${API_BASE_URL}/health"
curl --fail --silent --show-error "${API_BASE_URL}/health" >/dev/null

echo "Checking web login at ${WEB_BASE_URL}/login"
curl --fail --silent --show-error "${WEB_BASE_URL}/login" >/dev/null

echo "Checking waiter login at ${WAITER_BASE_URL}"
curl --fail --silent --show-error "${WAITER_BASE_URL}" >/dev/null

echo "Checking PWA manifest at ${MANIFEST_URL}"
curl --fail --silent --show-error "${MANIFEST_URL}" >/dev/null

echo "Smoke checks passed."
