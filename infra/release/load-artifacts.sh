#!/usr/bin/env bash
set -euo pipefail

RECORD="${1:?Usage: load-artifacts.sh <artifact-record.json>}"
DIRECTORY="$(cd "$(dirname "$RECORD")" && pwd)"

for target in api web; do
  archive="$(node -p "require(process.argv[1]).${target}.archive" "$RECORD")"
  expected="$(node -p "require(process.argv[1]).${target}.archiveDigest" "$RECORD")"
  image="$(node -p "require(process.argv[1]).${target}.tag" "$RECORD")"
  digest="$(node -p "require(process.argv[1]).${target}.digest" "$RECORD")"
  [[ "$archive" == "${target}-image.tar.gz" && "$expected" =~ ^sha256:[a-f0-9]{64}$ ]]
  actual="sha256:$(sha256sum "$DIRECTORY/$archive" | cut -d' ' -f1)"
  [[ "$actual" == "$expected" ]] || { printf '[error] %s archive checksum mismatch\n' "$target" >&2; exit 3; }
  gzip -dc "$DIRECTORY/$archive" | docker load >/dev/null
  [[ "$(docker image inspect --format '{{.Id}}' "$image")" == "$digest" ]] || {
    printf '[error] %s loaded image identity mismatch\n' "$target" >&2
    exit 4
  }
done

printf '%s\n' "$RECORD"
