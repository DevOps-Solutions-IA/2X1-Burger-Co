import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  describeCustomerAutomation,
  operationalReportSchema,
} from '../../apps/web/src/features/overview/contracts';

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
const overviewContractsSource = readFileSync(
  new URL('../../apps/web/src/features/overview/contracts.ts', import.meta.url),
  'utf8',
);
const posCartSource = readFileSync(
  new URL('../../apps/web/src/features/pos/PosCartPanel.tsx', import.meta.url),
  'utf8',
);
const productsSource = readFileSync(
  new URL('../../apps/web/src/app/(app)/products/page.tsx', import.meta.url),
  'utf8',
);
const ingredientsSource = readFileSync(
  new URL('../../apps/web/src/app/(app)/ingredients/page.tsx', import.meta.url),
  'utf8',
);
const tablesSource = readFileSync(
  new URL('../../apps/web/src/app/(app)/tables/page.tsx', import.meta.url),
  'utf8',
);
const deliverySource = readFileSync(
  new URL('../../apps/web/src/features/delivery-operations/delivery-operations-screen.tsx', import.meta.url),
  'utf8',
);
const sofiaSource = readFileSync(
  new URL('../../apps/web/src/app/(app)/sofia/page.tsx', import.meta.url),
  'utf8',
);

const completeReport = {
  period: { start: '2026-08-13', end: '2026-08-13' },
  journey: { status: 'OPEN' },
  cash: { expectedAmount: 0 },
  sales: { total: 0, count: 0, itemsSold: 0, byPaymentMethod: [], byChannel: [], bestSellers: [] },
  purchases: { total: 0, count: 0 },
  expenses: { total: 0, count: 0 },
  metrics: { costOfSales: 0, grossProfit: 0, netProfit: 0 },
  replenishment: {
    lowStock: [], criticalStock: [], outOfStock: [],
    productLowStock: [], productCriticalStock: [], productOutOfStock: [],
  },
  metadata: { source: 'domain', generatedAt: '2026-08-13T00:00:00.000Z', snapshotId: null },
};

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

test('overview authoritative arrays and customer automation flags fail closed', () => {
  assert.doesNotMatch(overviewContractsSource, /(?:byPaymentMethod|byChannel|bestSellers): z\.array\([^\n]+\.default\(\[\]\)/);
  assert.doesNotMatch(overviewContractsSource, /(?:lowStock|criticalStock|outOfStock): z\.array\([^\n]+\.default\(\[\]\)/);
  assert.match(overviewContractsSource, /flags\.productionEnabled && 'Producción habilitada'/);
  assert.match(overviewSource, /describeCustomerAutomation\(health\.metrics\.effectiveFlags\)/);

  assert.equal(operationalReportSchema.safeParse(completeReport).success, true);
  const incompleteReport = structuredClone(completeReport) as Record<string, unknown>;
  delete (incompleteReport.sales as Record<string, unknown>).bestSellers;
  assert.equal(operationalReportSchema.safeParse(incompleteReport).success, false);

  assert.equal(describeCustomerAutomation({
    productionEnabled: false,
    realSendingEnabled: false,
    autoReplyEnabled: false,
    autoSafeEnabled: false,
  }).state, 'blocked');
  assert.equal(describeCustomerAutomation({
    productionEnabled: true,
    realSendingEnabled: false,
    autoReplyEnabled: false,
    autoSafeEnabled: false,
  }).state, 'degraded');
});

test('operational metrics remain unavailable until their authoritative queries succeed', () => {
  assert.match(productsSource, /const metricsAvailable = products\.isSuccess && Boolean\(products\.data\)/);
  assert.match(productsSource, /value=\{metricsAvailable \? formatNumber\(metrics\.active\) : undefined\}/);
  assert.match(ingredientsSource, /const metricsAvailable = ingredients\.isSuccess && Boolean\(ingredients\.data\)/);
  assert.match(ingredientsSource, /value=\{metricsAvailable \? formatNumber\(metrics\.active\) : undefined\}/);
  assert.match(tablesSource, /const metricsAvailable = tables\.isSuccess && Boolean\(tables\.data\)/);
  assert.match(tablesSource, /value=\{metricsAvailable \? formatNumber\(metrics\.total\) : undefined\}/);
  assert.match(deliverySource, /const deliveriesAvailable = deliveries\.isSuccess && Boolean\(deliveries\.data\)/);
  assert.match(deliverySource, /value=\{deliveriesAvailable \? summary\.pending : undefined\}/);
});

test('Sofia settings-only sources and activation links are capability-bound', () => {
  assert.match(sofiaSource, /enabled: canReadGovernance/);
  assert.match(sofiaSource, /enabled: canReadAlerts/);
  assert.match(sofiaSource, /canOpenActivationControl \? <Button/);
  assert.match(sofiaSource, /data-testid="sofia-governance-restricted"/);
  assert.doesNotMatch(sofiaSource, /useSofia(?:Readiness|GovernanceEvents|Alerts)\(/);
});

test('POS quantity controls retain accessible touch targets', () => {
  assert.match(posCartSource, /aria-label=\{`Reducir cantidad[^\n]+className="flex h-11 w-11/);
  assert.match(posCartSource, /aria-label=\{`Aumentar cantidad[^\n]+className="flex h-11 w-11/);
  assert.doesNotMatch(posCartSource, /aria-label=\{`(?:Reducir|Aumentar) cantidad[^\n]+className="flex h-10 w-10/);
});
