import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canOperateSafetyControls,
  isSafetyReasonValid,
} from '../../apps/web/src/features/governance/activation-control';

const activationSource = readFileSync(
  new URL('../../apps/web/src/features/governance/activation-control.tsx', import.meta.url),
  'utf8',
);
const riderSource = readFileSync(
  new URL('../e2e/ephemeral/phase8-rider-accessibility.spec.ts', import.meta.url),
  'utf8',
);
const waiterSource = readFileSync(
  new URL('../e2e/waiter.mobile.spec.ts', import.meta.url),
  'utf8',
);

test('activation controls require an authorized role and settings.update capability', () => {
  assert.equal(canOperateSafetyControls({ roles: ['admin'], permissions: [] }), false);
  assert.equal(canOperateSafetyControls({ roles: ['supervisor'], permissions: [] }), false);
  assert.equal(canOperateSafetyControls({ roles: ['cashier'], permissions: ['settings.update'] }), false);
  assert.equal(canOperateSafetyControls({ roles: ['admin'], permissions: ['settings.update'] }), true);
  assert.equal(canOperateSafetyControls({ roles: ['supervisor'], permissions: ['settings.update'] }), true);
  assert.match(activationSource, /if \(!canOperateSafety \|\| \(action === 'unkill' && !isAdmin\)\)/);
});

test('activation confirmation is disabled and exposes a field error until a required reason is valid', () => {
  assert.equal(isSafetyReasonValid('pause', ' corto '), false);
  assert.equal(isSafetyReasonValid('kill', '12345678'), true);
  assert.equal(isSafetyReasonValid('resume', ''), true);
  assert.equal(isSafetyReasonValid('unkill', ''), true);
  assert.match(activationSource, /disabled=\{control\.isPending \|\| !canConfirmPendingAction\}/);
  assert.match(activationSource, /error=\{reasonIsValid \? null : 'Escribe un motivo de al menos 8 caracteres\.'\}/);
  assert.match(activationSource, /minLength=\{8\}/);
  assert.match(activationSource, /<Field[\s\S]*required[\s\S]*error=\{/);
});

test('waiter and rider accessibility workflows preserve phone and tablet coverage and add desktop', () => {
  for (const source of [riderSource, waiterSource]) {
    assert.match(source, /width: 390, height: 844/);
    assert.match(source, /width: 768, height: 1024/);
    assert.match(source, /width: 1440, height: 900/);
    assert.match(source, /expectNoHorizontalOverflow\(page\)/);
    assert.match(source, /expectAccessiblePage\(page\)/);
  }
});
