import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('canary deployment renders a complete fail-closed environment before Docker startup', () => {
  const root = process.cwd();
  const stateDir = mkdtempSync(path.join(tmpdir(), 'inventory-canary-config-'));
  const recordPath = path.join(stateDir, 'artifact-record.json');
  const digest = `sha256:${'a'.repeat(64)}`;
  writeFileSync(recordPath, JSON.stringify({
    manifest: {
      buildId: 'phase7-config-test',
      dirtyBuild: false,
      schemaMigrationCount: 38,
      migrationInventory: Array.from({ length: 38 }, (_, index) => `migration-${index + 1}`),
    },
    api: { digest },
    web: { digest },
  }));

  const result = spawnSync('bash', [
    path.join(root, 'infra/release/canary-deploy.sh'),
    recordPath,
    stateDir,
  ], {
    cwd: root,
    env: { ...process.env, CANARY_CONFIG_ONLY: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const rendered = readFileSync(path.join(stateDir, 'canary.env'), 'utf8');
  for (const expected of [
    'CANARY_PUBLIC_WEB_ORIGIN=https://canary-web.local.invalid',
    'CANARY_PUBLIC_PAYMENTS_BASE_URL=https://canary-pay.local.invalid',
    'CANARY_PUBLIC_API_URL=https://canary-api.local.invalid',
    `CANARY_API_DIGEST=${digest}`,
    `CANARY_WEB_DIGEST=${digest}`,
  ]) {
    assert.match(rendered, new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(rendered, /^CANARY_CRM_IDENTITY_HASH_SECRET=[a-f0-9]{96}$/m);
});

test('canary deployment waits for bounded service health before smoke', () => {
  const deploy = readFileSync('infra/release/canary-deploy.sh', 'utf8');
  assert.match(
    deploy,
    /docker compose[^\n]*up -d --force-recreate \\\n\s+--wait --wait-timeout 120 canary-api canary-web/,
  );
  for (const binding of [
    'export CANARY_API_IMAGE="$API_DIGEST"',
    'export CANARY_WEB_IMAGE="$WEB_DIGEST"',
    'export CANARY_API_DIGEST="$API_DIGEST"',
    'export CANARY_WEB_DIGEST="$WEB_DIGEST"',
    'export RELEASE_BUILD_ID="$BUILD_ID"',
  ]) {
    assert.ok(deploy.includes(binding), `missing explicit release binding: ${binding}`);
  }
  assert.match(deploy, /INITIALIZED_FILE="\$STATE_DIR\/database-initialized"/);
  assert.match(deploy, /if \[\[ ! -f "\$INITIALIZED_FILE" \]\]; then/);
  assert.match(deploy, /PRISMA_GENERATE_SKIP_AUTOINSTALL=1 pnpm exec prisma generate/);
  assert.match(deploy, /pnpm --dir "\$ROOT_DIR\/apps\/api" exec tsx "\$ROOT_DIR\/prisma\/seed\.ts"/);
  assert.doesNotMatch(deploy, /canary-migrate[^\n]*tsx/);
});

test('rollback canary rebuilds the exact forward-compatible bridge source', () => {
  const status = JSON.parse(readFileSync('.engineering/sofia-production/master-status.json', 'utf8'));
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const forwardCompatibleBridge = 'dc748b03b52c83f34882edc64de859cc9ab50645';

  assert.match(status.productionSha, /^[a-f0-9]{40}$/);
  assert.ok(
    workflow.includes(`build-artifacts.sh ${forwardCompatibleBridge}`),
    'rollback baseline must match the reviewed forward-compatible bridge SHA',
  );
  assert.notEqual(forwardCompatibleBridge, status.productionSha);
});
