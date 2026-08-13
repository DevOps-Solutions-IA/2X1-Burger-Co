import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appShellSource = readFileSync(
  new URL('../../apps/web/src/components/app-shell.tsx', import.meta.url),
  'utf8',
);
const overviewSource = readFileSync(
  new URL('../../apps/web/src/features/overview/overview-screen.tsx', import.meta.url),
  'utf8',
);
const overviewQueriesSource = readFileSync(
  new URL('../../apps/web/src/features/overview/queries.ts', import.meta.url),
  'utf8',
);
const posCartSource = readFileSync(
  new URL('../../apps/web/src/features/pos/PosCartPanel.tsx', import.meta.url),
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

test('shared navigation and operational polling use the canonical route policy', () => {
  assert.match(appShellSource, /items: section\.items\.filter\(\(item\) => canAccessRoute\(/);
  assert.match(
    appShellSource,
    /const canReadOperationalReport = canAccessRoute\('\/reports', user\?\.permissions, user\?\.roles\);/,
  );
  assert.match(appShellSource, /\{canReadOperationalReport \? \([\s\S]*?<SaleCounters \/>[\s\S]*?\) : null\}/);
  assert.match(appShellSource, /const canUseGlobalSearch = \['\/customers',[\s\S]*?\.some\(\(route\) => canAccessRoute\(/);
  assert.match(overviewSource, /useOperationalReport\(routeAccess\.reports\)/);
  assert.match(overviewQueriesSource, /export function useOperationalReport\(enabled = true\)/);
  assert.match(overviewQueriesSource, /enabled,[\s\S]*?refetchInterval: enabled \?/);
});

test('overview actions and operational cards fail closed through route capabilities', () => {
  for (const route of [
    '/activation-control',
    '/analytics',
    '/cash',
    '/conversations',
    '/deliveries',
    '/inventory',
    '/kitchen',
    '/orders',
    '/payments',
    '/pos',
    '/reports',
  ]) {
    assert.match(overviewSource, new RegExp(`canAccess\\('${route}'\\)`), route);
  }

  assert.match(overviewSource, /buildAttentionAlerts\(report\)\.filter\(\(alert\) => canAccess\(alert\.href\)\)/);
  assert.match(overviewSource, /routeAccess\.payments \? \([\s\S]*?href="\/payments"[\s\S]*?label="Pagos en revisión"/);
  assert.doesNotMatch(overviewSource, /href="\/customer-service"[\s\S]{0,160}label="Pagos en revisión"/);
});

test('POS quantity controls retain accessible touch targets', () => {
  assert.match(posCartSource, /aria-label=\{`Reducir cantidad[^\n]+className="flex h-11 w-11/);
  assert.match(posCartSource, /aria-label=\{`Aumentar cantidad[^\n]+className="flex h-11 w-11/);
  assert.doesNotMatch(posCartSource, /aria-label=\{`(?:Reducir|Aumentar) cantidad[^\n]+className="flex h-10 w-10/);
});
