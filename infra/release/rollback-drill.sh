#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="${1:?Usage: rollback-drill.sh <baseline-record> <candidate-record> [state-dir]}"
CANDIDATE="${2:?Usage: rollback-drill.sh <baseline-record> <candidate-record> [state-dir]}"
STATE_DIR="${3:-/tmp/inventory-fastfood-canary}"
RESULT="$STATE_DIR/rollback-drill.json"
mkdir -p "$STATE_DIR"

deploy_and_smoke() {
  local record="$1"
  local started="$SECONDS"
  "$ROOT_DIR/infra/release/canary-deploy.sh" "$record" "$STATE_DIR" >/dev/null
  "$ROOT_DIR/infra/release/canary-smoke.sh" "$record" "$STATE_DIR" >/dev/null
  printf '%s' "$((SECONDS - started))"
}

BASELINE_INITIAL_SECONDS="$(deploy_and_smoke "$BASELINE")"
CANDIDATE_SECONDS="$(deploy_and_smoke "$CANDIDATE")"
ROLLBACK_SECONDS="$(deploy_and_smoke "$BASELINE")"
RESTORE_SECONDS="$(deploy_and_smoke "$CANDIDATE")"

node - "$RESULT" "$BASELINE" "$CANDIDATE" "$BASELINE_INITIAL_SECONDS" "$CANDIDATE_SECONDS" "$ROLLBACK_SECONDS" "$RESTORE_SECONDS" <<'NODE'
const fs=require('fs');
const [output, baselinePath, candidatePath, baselineInitial, candidate, rollback, restore]=process.argv.slice(2);
const baselineRecord=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const candidateRecord=JSON.parse(fs.readFileSync(candidatePath,'utf8'));
fs.writeFileSync(output, JSON.stringify({
  status:'PASS',
  mechanism:'local-content-digest',
  baselineDigest:baselineRecord.api.digest,
  candidateDigest:candidateRecord.api.digest,
  durationsSeconds:{baselineInitial:Number(baselineInitial),candidate:Number(candidate),rollback:Number(rollback),candidateRestore:Number(restore)},
  databaseRollbackPerformed:false,
  rebuildDuringRollback:false,
},null,2)+'\n');
NODE
cat "$RESULT"
