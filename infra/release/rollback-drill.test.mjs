import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const drill = path.join(root, 'infra/release/rollback-drill.sh');

function executable(directory, name, source) {
  const target = path.join(directory, name);
  writeFileSync(target, `#!/usr/bin/env bash\nset -euo pipefail\n${source}\n`);
  chmodSync(target, 0o700);
  return target;
}

function artifact(directory, name, apiCharacter, webCharacter) {
  const target = path.join(directory, `${name}.json`);
  writeFileSync(target, JSON.stringify({
    manifest: { buildId: name, dirtyBuild: false },
    api: { digest: `sha256:${apiCharacter.repeat(64)}` },
    web: { digest: `sha256:${webCharacter.repeat(64)}` },
  }));
  return target;
}

function fixture({ ineffectiveFailure = false, mutateRpo = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sofia-rollback-drill-'));
  const state = path.join(directory, 'state');
  const baseline = artifact(directory, 'baseline', 'a', 'b');
  const candidate = artifact(directory, 'candidate', 'c', 'd');
  const deploy = executable(directory, 'deploy.sh', String.raw`
record="$1"; state="$2"; mkdir -p "$state"
node -e "const r=require(process.argv[1]); process.stdout.write(r.api.digest+'|'+r.web.digest)" "$record" >"$state/active-images"
rm -f "$state/failed"
printf 'deploy:%s\n' "$(basename "$record")" >>"$state/events"
`);
  const smoke = executable(directory, 'smoke.sh', String.raw`
record="$1"; state="$2"
[[ ! -f "$state/failed" ]]
expected="$(node -e "const r=require(process.argv[1]); process.stdout.write(r.api.digest+'|'+r.web.digest)" "$record")"
[[ "$(cat "$state/active-images")" == "$expected" ]]
printf 'smoke:%s\n' "$(basename "$record")" >>"$state/events"
`);
  const inject = executable(directory, 'inject.sh', ineffectiveFailure ? ':' : 'touch "$2/failed"');
  const verify = executable(directory, 'verify.sh', String.raw`
record="$1"; state="$2"
expected="$(node -e "const r=require(process.argv[1]); process.stdout.write(r.api.digest+'|'+r.web.digest)" "$record")"
[[ "$(cat "$state/active-images")" == "$expected" ]]
`);
  const snapshot = executable(directory, 'snapshot.sh', mutateRpo
    ? 'counter="$1/rpo-counter"; value=before; [[ -f "$counter" ]] && value=after; touch "$counter"; printf "%s" "$value"'
    : 'printf "%s" "stable-financial-and-operational-state"');

  return {
    directory,
    state,
    baseline,
    candidate,
    env: {
      ...process.env,
      ROLLBACK_DEPLOY_COMMAND: deploy,
      ROLLBACK_SMOKE_COMMAND: smoke,
      ROLLBACK_FAILURE_INJECTION_COMMAND: inject,
      ROLLBACK_VERIFY_IMAGES_COMMAND: verify,
      ROLLBACK_RPO_SNAPSHOT_COMMAND: snapshot,
    },
  };
}

function run(instance) {
  return spawnSync('bash', [drill, instance.baseline, instance.candidate, instance.state], {
    cwd: root,
    env: instance.env,
    encoding: 'utf8',
  });
}

test('injects a detected failure and rolls API and Web back with RTO and RPO evidence', () => {
  const instance = fixture();
  const result = run(instance);
  assert.equal(result.status, 0, result.stderr);

  const evidence = JSON.parse(readFileSync(path.join(instance.state, 'rollback-drill.json'), 'utf8'));
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.failureInjected, true);
  assert.equal(evidence.failureSmokeRejected, true);
  assert.deepEqual(evidence.rollbackVerified, { api: true, web: true });
  assert.equal(evidence.baseline.apiDigest, `sha256:${'a'.repeat(64)}`);
  assert.equal(evidence.baseline.webDigest, `sha256:${'b'.repeat(64)}`);
  assert.equal(evidence.candidate.apiDigest, `sha256:${'c'.repeat(64)}`);
  assert.equal(evidence.candidate.webDigest, `sha256:${'d'.repeat(64)}`);
  assert.equal(evidence.rpo.status, 'PASS');
  assert.equal(evidence.rpo.beforeDigest, evidence.rpo.afterDigest);
  assert.ok(Number.isInteger(evidence.rtoMilliseconds));
  assert.equal(evidence.databaseRollbackPerformed, false);
  assert.equal(evidence.rebuildDuringRollback, false);
  assert.equal(evidence.candidateRestoredAfterRollback, false);

  const events = readFileSync(path.join(instance.state, 'events'), 'utf8').trim().split('\n');
  assert.deepEqual(events.filter((event) => event.startsWith('deploy:')), [
    'deploy:baseline.json',
    'deploy:candidate.json',
    'deploy:baseline.json',
  ]);
});

test('fails closed when the injected failure does not make smoke fail', () => {
  const instance = fixture({ ineffectiveFailure: true });
  const result = run(instance);
  assert.notEqual(result.status, 0);
  const evidence = JSON.parse(readFileSync(path.join(instance.state, 'rollback-drill.json'), 'utf8'));
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.failedStage, 'failure-injection');
});

test('fails closed when post-rollback RPO invariants differ', () => {
  const instance = fixture({ mutateRpo: true });
  const result = run(instance);
  assert.notEqual(result.status, 0);
  const evidence = JSON.parse(readFileSync(path.join(instance.state, 'rollback-drill.json'), 'utf8'));
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.failedStage, 'rollback');
});

test('fails closed when a configured invariant hook is unavailable', () => {
  const instance = fixture();
  instance.env.ROLLBACK_RPO_SNAPSHOT_COMMAND = path.join(instance.directory, 'missing-hook');
  const result = run(instance);
  assert.notEqual(result.status, 0);
  const evidence = JSON.parse(readFileSync(path.join(instance.state, 'rollback-drill.json'), 'utf8'));
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.failedStage, 'rpo-snapshot-before-failure');
});

test('does not contain rebuild or down-migration execution paths', () => {
  const source = readFileSync(drill, 'utf8');
  assert.doesNotMatch(source, /docker\s+(?:build|image\s+build)|prisma\s+migrate\s+(?:reset|dev)|migrate\s+down/i);
  assert.match(source, /stop --timeout 1 canary-api canary-web/);
  assert.match(source, /databaseRollbackPerformed: false/);
  assert.match(source, /rebuildDuringRollback: false/);
});

test('snapshots every required operational and financial authority deterministically', () => {
  const source = readFileSync(drill, 'utf8');
  const requiredTables = [
    'products',
    'ingredients',
    'inventory_movements',
    'cash_sessions',
    'cash_movements',
    'sales',
    'sale_items',
    'sale_payments',
    'order_tickets',
    'order_ticket_items',
    'order_checkouts',
    'payment_intents',
    'payment_links',
    'payment_transitions',
    'payment_webhook_events',
    'delivery_workflow_events',
    'delivery_issues',
    'delivery_location_inbox',
    'notification_intents',
    'sofia_commands',
    'whatsapp_messages',
    'whatsapp_inbound_events',
    'whatsapp_outbound_messages',
    'whatsapp_message_status_events',
    'whatsapp_delivery_orders',
    'customer_service_cases',
    'customer_service_case_events',
  ];

  for (const table of requiredTables) {
    assert.match(source, new RegExp(`'${table.replaceAll('_', '\\_')}'`));
    assert.match(source, new RegExp(`FROM ${table} t`));
  }

  assert.match(source, /ORDER BY id/);
  assert.match(source, /to_jsonb\(t\)::text/);
  assert.match(source, /sum\("currentStock"\)/);
  assert.match(source, /sum\("openingAmount"\)/);
  assert.match(source, /sum\("closingAmount"\)/);
  assert.match(source, /'snapshotSchemaVersion', 2/);
});

test('fails closed before snapshotting when any required frontier-37 table is absent', () => {
  const source = readFileSync(drill, 'utf8');
  const preflightStart = source.indexOf('DO $rpo_preflight$');
  const snapshotStart = source.indexOf('SELECT jsonb_build_object(');

  assert.ok(preflightStart >= 0);
  assert.ok(snapshotStart > preflightStart);
  assert.match(source, /to_regclass\(format\('%I\.%I', 'public', required_table\)\) IS NULL/);
  assert.match(source, /RAISE EXCEPTION 'RPO snapshot requires missing tables:/);
  assert.match(source, /psql -X -qAt -v ON_ERROR_STOP=1/);
});
