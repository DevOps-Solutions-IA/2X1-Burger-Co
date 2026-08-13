import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { boundRowsForRendering } from '../../apps/web/src/components/product/data-table-shell';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, 'apps/web/src', relativePath), 'utf8');
}

test('bounds shared table rendering without duplicating row identity', () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({ id: index + 1 }));
  const result = boundRowsForRendering(rows, 50);

  assert.equal(result.visibleRows.length, 50);
  assert.equal(result.hiddenRowCount, 75);
  assert.deepEqual(result.visibleRows.map((row) => row.id), Array.from({ length: 50 }, (_, index) => index + 1));
});

test('uses safe bounds for invalid render limits', () => {
  const rows = [1, 2, 3];

  assert.deepEqual(boundRowsForRendering(rows, Number.NaN).visibleRows, rows);
  assert.deepEqual(boundRowsForRendering(rows, 0).visibleRows, [1]);
});

test('keeps one main landmark authority in the application shell', () => {
  const featureRoots = [
    'features/crm/crm-module.tsx',
    'features/delivery-operations/delivery-operations-screen.tsx',
    'features/financial-operations/payments-screen.tsx',
    'features/governance/activation-control.tsx',
    'features/governance/audit-workspace.tsx',
    'features/governance/settings-workspace.tsx',
    'features/governance/team-workspace.tsx',
    'features/order-operations/kitchen-screen.tsx',
    'features/order-operations/order-detail-screen.tsx',
    'features/order-operations/orders-screen.tsx',
    'features/overview/analytics-screen.tsx',
    'features/overview/overview-screen.tsx',
    'features/support-operations/customer-service-screen.tsx',
  ];

  for (const path of featureRoots) {
    assert.doesNotMatch(source(path), /<\/?main\b/, path);
  }
});

test('uses bounded selection semantics for payment views', () => {
  const payments = source('features/financial-operations/payments-screen.tsx');

  assert.match(payments, /aria-pressed=\{view === option\.id\}/);
  assert.doesNotMatch(payments, /role="tab(?:list)?"/);
});

test('announces only concise delivery status changes', () => {
  const delivery = source('features/delivery-operations/delivery-operations-screen.tsx');

  assert.doesNotMatch(delivery, /data-testid="deliveries-detail"[^>]*aria-live/);
  assert.match(delivery, /className="sr-only" role="status" aria-live="polite" aria-atomic="true"/);
});

test('keeps authenticated desktop operations at the WCAG contrast floor', () => {
  const operationRoutes = [
    'app/(app)/categories/page.tsx',
    'app/(app)/expenses/page.tsx',
    'app/(app)/purchases/page.tsx',
    'app/(app)/recipes/page.tsx',
    'app/(app)/reports/page.tsx',
    'app/(app)/suppliers/page.tsx',
    'app/(app)/tables/page.tsx',
  ];

  for (const path of operationRoutes) {
    const route = source(path);

    assert.doesNotMatch(route, /text-\[(?:9|10|11)px\]/, `${path} uses operational text below 12px`);
    assert.doesNotMatch(route, /text-stone-(?:300|400|500)/, `${path} uses low-contrast stone text`);
    assert.doesNotMatch(route, /text-brand-700/, `${path} uses low-contrast brand text`);
  }
});
