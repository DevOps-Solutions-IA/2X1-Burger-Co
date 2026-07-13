#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

git grep -Il '' -- ':!*.png' ':!*.jpg' ':!*.pdf' \
  ':!.engineering/evidence/**' ':!infra/environments/**' ':!infra/release/secret-scan.sh' \
  | while IFS= read -r file; do
      if grep -Eq '(^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|data:image/[A-Za-z]+;base64,[A-Za-z0-9+/=]{80,})' "$file"; then
        printf '%s\n' "$file" >>"$OUTPUT"
      fi
      if grep -Eq '^(DEEPSEEK_API_KEY|HERMES_API_TOKEN|GOOGLE_MAPS_API_KEY|OPENROUTESERVICE_API_KEY)=[^[:space:]\[]+' "$file"; then
        printf '%s\n' "$file" >>"$OUTPUT"
      fi
    done

if [[ -s "$OUTPUT" ]]; then
  echo "Potential secret values found in tracked files:" >&2
  sort -u "$OUTPUT" >&2
  exit 1
fi
echo "Secret scan passed; values were not printed."
