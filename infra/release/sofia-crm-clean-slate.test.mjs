import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Guarda la arquitectura real de la Fase A del programa SOFIA + CRM.
// Sustituye al guard de "clean slate" ahora que las rutas SOFIA/CRM
// consumen datos reales del backend en vez del placeholder neutral.

const root = process.cwd();
const web = (...segments) => path.join(root, 'apps', 'web', 'src', ...segments);
const read = (...segments) => readFileSync(web(...segments), 'utf8');

function listFilesRecursive(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listFilesRecursive(fullPath).map((p) => path.join(entry, p));
    return [entry];
  });
}

test('SOFIA operator routes are connected to real backend-typed data, not the neutral placeholder', () => {
  const overview = read('app', '(app)', 'sofia', 'page.tsx');
  const crm = read('app', '(app)', 'sofia', 'crm', 'page.tsx');
  const whatsappQr = read('app', '(app)', 'sofia', 'whatsapp-qr', 'page.tsx');
  const conversations = read('app', '(app)', 'sofia', 'conversations', 'page.tsx');

  for (const source of [overview, crm, whatsappQr, conversations]) {
    assert.doesNotMatch(source, /SofiaCleanSlatePlaceholder/);
    assert.doesNotMatch(source, /\bmock\b|\bsample\b|\bfake\b|\bdemo\b/i);
  }

  assert.match(overview, /useSofiaDashboardSummary/);
  assert.match(whatsappQr, /useSofiaQrStatus/);
  assert.match(conversations, /useSofiaConversationsInbox/);
  assert.match(crm, /CustomersListView/);
});

test('SOFIA/CRM legacy deep links keep redirecting to their real destination', () => {
  assert.match(read('app', '(app)', 'sofia', 'customers', 'page.tsx'), /redirect\('\/sofia\/crm'\)/);
  assert.match(read('app', '(app)', 'sofia', 'customers', '[customerId]', 'page.tsx'), /redirect\(`\/sofia\/crm\/customers\//);
});

test('Customer 360 route exists and aggregates real customer data', () => {
  const detail = read('app', '(app)', 'sofia', 'crm', 'customers', '[customerId]', 'page.tsx');
  assert.match(detail, /useSofiaCrmCustomer/);
  assert.match(detail, /Customer360Tabs/);
});

test('SOFIA workspace component family matches the expected active set', () => {
  const componentDirectory = web('components', 'sofia');
  const activeComponents = listFilesRecursive(componentDirectory).sort();
  const expectedComponents = [
    path.join('workspace', 'Customer360Tabs.tsx'),
    path.join('workspace', 'MetricTile.tsx'),
    path.join('workspace', 'OperatorWorkspaceFrame.tsx'),
    path.join('workspace', 'PendingPhasePage.tsx'),
    path.join('workspace', 'PhaseBoundaryNotice.tsx'),
    path.join('workspace', 'QueryStateBoundary.tsx'),
    path.join('workspace', 'StatusBadge.tsx'),
    path.join('workspace', 'WorkspaceHeader.tsx'),
    path.join('workspace', 'WorkspaceTabs.tsx'),
    path.join('workspace', 'index.ts'),
    path.join('workspace', 'status-tone.ts'),
  ].sort();
  assert.deepEqual(activeComponents, expectedComponents);
  assert.equal(existsSync(path.join(componentDirectory, 'SofiaCleanSlatePlaceholder.tsx')), false);
});

test('SOFIA contracts, query layer, PII guards, and frontend auth remain available', () => {
  const contracts = read('features', 'sofia', 'contracts.ts');
  const queries = read('features', 'sofia', 'queries.ts');

  assert.match(contracts, /sofiaCrmMaskedIdentitySchema/);
  assert.match(contracts, /valueMasked/);
  assert.match(queries, /useSofiaCrmCustomers/);
  assert.match(queries, /useSofiaConversationsInbox/);
  assert.equal(existsSync(web('features', 'auth', 'auth-provider.tsx')), true);
  assert.equal(existsSync(web('features', 'auth', 'access-control.ts')), true);
});

test('no productive mutations are wired into Phase A operator/CRM routes', () => {
  // Fase A es de solo lectura: pausar/tomar/liberar conversaciones y conectar
  // el QR real son mutaciones productivas que llegan en fases posteriores.
  const conversations = read('app', '(app)', 'sofia', 'conversations', 'page.tsx');
  const whatsappQr = read('app', '(app)', 'sofia', 'whatsapp-qr', 'page.tsx');
  assert.doesNotMatch(conversations, /useMutation/);
  assert.doesNotMatch(whatsappQr, /useMutation/);
});
