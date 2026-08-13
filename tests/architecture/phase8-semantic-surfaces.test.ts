import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { boundRowsForRendering } from '../../apps/web/src/components/product/data-table-shell';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, 'apps/web/src', relativePath), 'utf8');
}

function operationalRoutes() {
  const appRoot = resolve(repositoryRoot, 'apps/web/src/app');
  return readdirSync(appRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name === 'page.tsx' || entry.name === 'route.ts'))
    .map((entry) => {
      const segments = resolve(entry.parentPath, entry.name)
        .slice(appRoot.length + 1)
        .split('/')
        .filter((segment) => !segment.startsWith('(') && segment !== 'page.tsx' && segment !== 'route.ts');
      return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
    })
    .sort();
}

test('classifies every frontend route explicitly in the Phase 8 audit', () => {
  const audit = readFileSync(resolve(repositoryRoot, '.engineering/sofia-production/phases/phase-08/route-audit.md'), 'utf8');

  for (const route of operationalRoutes()) {
    assert.ok(audit.includes('| `' + route + '` |'), route);
  }
});

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

test('keeps field shells scrollable with valid shell-owned skip targets', () => {
  const rootLayout = source('app/layout.tsx');
  const globalCss = source('app/globals.css');
  const deliveryLayout = source('app/(delivery)/delivery-layout.client.tsx');
  const waiterLayout = source('app/(waiter)/waiter-layout.client.tsx');

  assert.doesNotMatch(rootLayout, /href="#main-content"/);
  assert.doesNotMatch(globalCss, /body\s*\{\s*overflow:\s*hidden/);
  assert.match(deliveryLayout, /href="#delivery-main"/);
  assert.match(waiterLayout, /href="#waiter-main"/);
  assert.match(deliveryLayout, /canAccessRoute\(safePathname, user\?\.permissions, user\?\.roles\)/);
});

test('places the application skip link before persistent navigation in keyboard order', () => {
  const appShell = source('components/app-shell.tsx');
  const skipLinkIndex = appShell.indexOf('href="#main-content"');
  const navigationIndex = appShell.indexOf('<aside');

  assert.notEqual(skipLinkIndex, -1);
  assert.notEqual(navigationIndex, -1);
  assert.ok(skipLinkIndex < navigationIndex);
});

test('keeps merged legacy routes on canonical enterprise modules', () => {
  assert.match(source('app/(app)/users/page.tsx'), /redirect\('\/team'\)/);
  assert.match(source('app/(app)/sofia/customers/page.tsx'), /redirect\('\/customers'\)/);
  assert.match(
    source('app/(app)/sofia/customers/[customerId]/page.tsx'),
    /redirect\(`\/customers\/\$\{encodeURIComponent\(customerId\)\}`\)/,
  );
  assert.match(source('app/(app)/sofia/conversations/page.tsx'), /redirect\('\/conversations'\)/);
  assert.match(source('app/(app)/sofia/whatsapp-qr/page.tsx'), /redirect\('\/activation-control'\)/);
});

test('names direct table assignment controls for assistive technology', () => {
  const tables = source('app/(app)/tables/page.tsx');

  assert.match(tables, /aria-label=\{`Asignación directa para \$\{table\.label\}`\}/);
});

test('keeps bounded report regions keyboard reachable', () => {
  const reports = source('app/(app)/reports/page.tsx');

  for (const label of ['Margen por producto', 'Rotación de insumos', 'Histórico de cierres', 'Histórico de notificaciones a proveedor']) {
    assert.match(reports, new RegExp(`aria-label="${label}" tabIndex=\\{0\\}`));
  }
});

test('uses explicit high-contrast status badges on dark surfaces', () => {
  const badge = source('components/product/status-badge.tsx');
  const crmOverview = source('features/crm/overview-view.tsx');

  assert.match(badge, /onDark && 'text-white'/);
  assert.match(crmOverview, /tone="warning" onDark/);
  assert.match(crmOverview, /tone="success" onDark/);
});

test('keeps governed recovery guidance readable on warning surfaces', () => {
  const recovery = source('features/crm/recovery-view.tsx');

  assert.match(recovery, /mt-1 text-sm leading-6 text-ink/);
});

test('keeps disabled actions readable and wide tables contained at tablet widths', () => {
  const button = source('components/ui/button.tsx');
  const table = source('components/product/data-table-shell.tsx');

  assert.match(button, /disabled:opacity-70/);
  assert.doesNotMatch(button, /disabled:opacity-50/);
  assert.match(table, /lg:min-w-max lg:grid-cols/);
  assert.doesNotMatch(table, /md:min-w-max md:grid-cols/);
});

test('requires explicit RBAC capabilities for customer evidence links', () => {
  const model = source('features/customer-operations/model.ts');

  assert.match(model, /access: CustomerOperationalRelationAccess,/);
  assert.doesNotMatch(model, /access: CustomerOperationalRelationAccess\s*=/);
});

test('uses canonical detail links for customer-service conversations', () => {
  const support = source('features/support-operations/customer-service-screen.tsx');

  assert.match(support, /`\/conversations\/\$\{encodeURIComponent\(serviceCase\.conversationId\)\}`/);
  assert.doesNotMatch(support, /\/conversations\?conversation=/);
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
