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
    path.join('workspace', 'PaginationBar.tsx'),
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

test('no forbidden business mutations are wired into SOFIA operator/CRM routes', () => {
  // SOFIA nunca debe crear pagos/pedidos reales, marcar pagos como PAID, ni
  // mover stock/caja/checkout/POS/domicilios (regla dura de CLAUDE.md). Se
  // revisa recursivamente todo el árbol de app/features/components de SOFIA
  // en busca de rutas HTTP que toquen esos dominios prohibidos, sin importar
  // si aparecen dentro de un useMutation o de cualquier otra llamada.
  // Cada patrón exige que el segmento prohibido viva DENTRO de un literal de
  // string completo (misma comilla de apertura y cierre), permitiendo
  // cualquier prefijo de ruta antes (ej. '/admin/checkout/confirm' también
  // debe detectarse) sin disparar falsos positivos sobre comentarios/prosa.
  const forbiddenPathPatterns = [
    /(['"`])[a-z0-9\-/]*\/(checkout|orders?)\/[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*\/(pos|cash-sessions?|caja)\/[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*mark-?(as-)?paid[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*\/(send-real|real-send)[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*whatsapp[a-z0-9\-/]*\/send[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*payment[a-z0-9\-/]*\/(capture|confirm)[a-z0-9\-/]*\1/i,
    /createRealPayment|createRealOrder/i,
  ];
  const dirsToScan = [
    web('app', '(app)', 'sofia'),
    web('features', 'sofia'),
    web('components', 'sofia'),
  ];
  for (const dir of dirsToScan) {
    for (const file of listFilesRecursive(dir)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const filePath = path.join(dir, file);
      const source = readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenPathPatterns) {
        assert.doesNotMatch(
          source,
          pattern,
          `${path.relative(root, filePath)} referencia una ruta prohibida (checkout/orders/pos/caja/mark-paid) — SOFIA nunca debe originar estas mutaciones`,
        );
      }
    }
  }
});

test('useMutation in the SOFIA/CRM tree is limited to the explicitly reviewed allowlist', () => {
  // Toda mutación fuera de esta lista requiere revisión explícita. Las
  // cuatro acciones de gobernanza (pausar/reanudar SOFIA, activar/desactivar
  // kill-switch) comparten un único useMutation privado (useSofiaGovernanceAction);
  // la transición de casos de servicio al cliente tiene el suyo propio.
  // Ninguna crea pedidos/pagos reales ni mueve stock/caja/checkout/POS/domicilios.
  const queries = read('features', 'sofia', 'queries.ts');
  const useMutationCount = (queries.match(/\buseMutation\(/g) ?? []).length;
  assert.equal(useMutationCount, 2, 'queries.ts debe declarar useMutation exactamente 2 veces: gobernanza y transición de casos');
  assert.match(queries, /function useSofiaGovernanceAction\(/);
  assert.match(queries, /export function useSofiaCustomerServiceTransition\(/);
  for (const hook of ['useSofiaPauseGlobal', 'useSofiaResumeGlobal', 'useSofiaActivateKillSwitch', 'useSofiaDeactivateKillSwitch']) {
    const start = queries.indexOf(`export function ${hook}(`);
    assert.notEqual(start, -1, `falta el hook ${hook}`);
    const body = queries.slice(start, start + 200);
    assert.match(body, /useSofiaGovernanceAction\(/, `${hook} debe delegar en useSofiaGovernanceAction, no declarar su propio useMutation`);
  }

  const dirsToScan = [
    web('app', '(app)', 'sofia'),
    web('features', 'sofia'),
    web('components', 'sofia'),
  ];
  for (const dir of dirsToScan) {
    for (const file of listFilesRecursive(dir)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const filePath = path.join(dir, file);
      if (filePath === web('features', 'sofia', 'queries.ts')) continue;
      const source = readFileSync(filePath, 'utf8');
      assert.doesNotMatch(
        source,
        /\buseMutation\(/,
        `${path.relative(root, filePath)} no debe declarar useMutation directamente — usar un hook revisado de queries.ts`,
      );
    }
  }
});
