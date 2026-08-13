import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appShellSource = readFileSync(
  new URL('../../apps/web/src/components/app-shell.tsx', import.meta.url),
  'utf8',
);

test('the application shell renders only an authoritative aggregate sales KPI', () => {
  assert.match(appShellSource, /data-testid="topbar-items-sold"/);
  assert.match(appShellSource, /data\.sales\.itemsSold/);
  assert.doesNotMatch(appShellSource, /bestSellers/);
  assert.doesNotMatch(appShellSource, /targetProducts/);
});

test('the application shell never fabricates absent per-product counts', () => {
  assert.doesNotMatch(appShellSource, /found\s*\?[^:]+:\s*0/);
  assert.doesNotMatch(appShellSource, /productName[^\n]+includes/);
  assert.doesNotMatch(appShellSource, /Maxy Family|Doble Carne|Sencilla/);
});
