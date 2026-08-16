import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Guarda la arquitectura de la Torre de Control SOFIA + CRM Enterprise —
// reconstrucción completa que reemplaza la Fase A original. La Torre de
// Control manda/controla/valida/muestra el comportamiento y la tasa de
// éxito del agente SOFIA; el CRM gestiona la relación comercial con el
// cliente (pipeline, tareas, notas, segmentos, campañas). Ninguna de las
// dos aloja registros de negocio que ya tienen su hogar normal (POS,
// Domicilios, Caja) — ese es el principio de no duplicación del programa.

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

test('Torre de Control routes are connected to real backend-typed data, not fabricated placeholders', () => {
  const overview = read('app', '(app)', 'sofia', 'page.tsx');
  const performance = read('app', '(app)', 'sofia', 'performance', 'page.tsx');
  const validation = read('app', '(app)', 'sofia', 'validation', 'page.tsx');
  const safety = read('app', '(app)', 'sofia', 'safety', 'page.tsx');
  const conversations = read('app', '(app)', 'sofia', 'conversations', 'page.tsx');
  const whatsappQr = read('app', '(app)', 'sofia', 'whatsapp-qr', 'page.tsx');

  for (const source of [overview, performance, validation, safety, conversations, whatsappQr]) {
    assert.doesNotMatch(source, /\bmock\b|\bsample\b|\bfake\b|\bdemo\b/i);
  }

  assert.match(overview, /useSofiaDashboardSummary|useSofiaMetricsSummary/);
  assert.match(performance, /useSofiaMetricsSummary/);
  assert.match(whatsappQr, /useSofiaQrStatus/);
  assert.match(conversations, /useSofiaConversationsInbox/);
  assert.match(safety, /useSofiaRuntimeSafety/);
});

test('Validation surfaces both SecureCommand queue and customer-service escalations, never fabricated', () => {
  const validationDir = web('features', 'sofia', 'validation');
  const files = listFilesRecursive(validationDir).map((f) => readFileSync(path.join(validationDir, f), 'utf8')).join('\n');
  assert.match(files, /useSecureCommands/);
  assert.match(files, /useSofiaCustomerServiceCases/);
  assert.doesNotMatch(files, /\bmock\b|\bsample\b|\bfake\b|\bdemo\b/i);
});

test('CRM routes are connected to real backend-typed data', () => {
  const customers = read('app', '(app)', 'sofia', 'crm', 'page.tsx');
  const pipeline = read('app', '(app)', 'sofia', 'crm', 'pipeline', 'page.tsx');
  const segments = read('app', '(app)', 'sofia', 'crm', 'segments', 'page.tsx');
  const campaigns = read('app', '(app)', 'sofia', 'crm', 'campaigns', 'page.tsx');
  const tasks = read('app', '(app)', 'sofia', 'crm', 'tasks', 'page.tsx');

  for (const source of [customers, pipeline, segments, campaigns, tasks]) {
    assert.doesNotMatch(source, /\bmock\b|\bsample\b|\bfake\b|\bdemo\b/i);
  }

  assert.match(customers, /CustomersListView/);
  assert.match(pipeline, /useSofiaCrmPipelines/);

  const featureFolderUsesHook = (folder, hookName, mountedComponentPattern, pageSource) => {
    const dir = web('features', 'sofia', 'crm', folder);
    const files = listFilesRecursive(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
    assert.match(pageSource, mountedComponentPattern, `la página de ${folder} debe montar un componente real de features/sofia/crm/${folder}`);
    assert.match(files, new RegExp(hookName));
  };
  featureFolderUsesHook('segments', 'useSofiaCrmSegments', /SegmentsListView|SegmentCard/, segments);
  featureFolderUsesHook('campaigns', 'useSofiaCrmCampaigns', /CampaignsView|CampaignCard/, campaigns);
  featureFolderUsesHook('tasks', 'useSofiaCrmTasks', /TasksView|TaskRow/, tasks);
});

test('campaign send always stays blocked-by-design in the UI copy, never presented as a real send', () => {
  const campaignsDir = web('features', 'sofia', 'crm', 'campaigns');
  const files = listFilesRecursive(campaignsDir).map((f) => readFileSync(path.join(campaignsDir, f), 'utf8')).join('\n');
  assert.match(files, /bloquead/i, 'la UI de campañas debe explicar que el envío real está bloqueado por diseño');
});

test('SOFIA/CRM legacy deep links keep redirecting to their real destination', () => {
  assert.match(read('app', '(app)', 'sofia', 'customers', 'page.tsx'), /redirect\('\/sofia\/crm'\)/);
  assert.match(read('app', '(app)', 'sofia', 'customers', '[customerId]', 'page.tsx'), /redirect\(`\/sofia\/crm\/customers\//);
});

test('Customer 360 route exists and aggregates all real customer data (identity, CRM pipeline, tasks, notes, cases)', () => {
  const detail = read('app', '(app)', 'sofia', 'crm', 'customers', '[customerId]', 'page.tsx');
  assert.match(detail, /useSofiaCrmCustomer/);
  assert.match(detail, /Customer360Tabs/);
  for (const panel of ['IdentityPanel', 'TagsPanel', 'SegmentsPanel', 'ConsentsPanel', 'ActivityPanel', 'LeadPanel', 'TasksPanel', 'NotesPanel', 'CasesPanel']) {
    assert.match(detail, new RegExp(panel), `Customer 360 debe montar ${panel}`);
  }
});

test('shared SOFIA component family matches the expected set — no orphan or duplicated design-system components', () => {
  const componentDirectory = web('components', 'sofia');
  const activeComponents = listFilesRecursive(componentDirectory).sort();
  const expectedComponents = [
    'chart-theme.ts',
    'console-theme.ts',
    'ControlTowerFrame.tsx',
    'CrmFrame.tsx',
    'Customer360Tabs.tsx',
    'EmptyStrip.tsx',
    'index.ts',
    'PageHeader.tsx',
    'Pager.tsx',
    'QueryStateBoundary.tsx',
    'SectionHeading.tsx',
    'SectionTabs.tsx',
    'StatCard.tsx',
    'StatusBadge.tsx',
    'status-tone.ts',
  ].sort();
  assert.deepEqual(activeComponents, expectedComponents);
});

test('SOFIA contracts, query layer, PII guards, and frontend auth remain available', () => {
  const contracts = read('features', 'sofia', 'contracts.ts');
  const queries = read('features', 'sofia', 'queries.ts');

  assert.match(contracts, /sofiaCrmMaskedIdentitySchema/);
  assert.match(contracts, /valueMasked/);
  assert.match(contracts, /secureCommandStatusSchema/);
  assert.match(queries, /useSofiaCrmCustomers/);
  assert.match(queries, /useSofiaConversationsInbox/);
  assert.match(queries, /useSecureCommands/);
  assert.equal(existsSync(web('features', 'auth', 'auth-provider.tsx')), true);
  assert.equal(existsSync(web('features', 'auth', 'access-control.ts')), true);
});

test('/sofia route stays gated behind a real permission in the frontend route map', () => {
  const accessControl = read('features', 'auth', 'access-control.ts');
  assert.match(accessControl, /prefix:\s*'\/sofia'.*permission:/s);
});

test('no forbidden business mutations are wired into SOFIA operator/CRM routes', () => {
  // SOFIA nunca debe crear pagos/pedidos reales, marcar pagos como PAID, ni
  // mover stock/caja/checkout/POS/domicilios (regla dura de CLAUDE.md). Se
  // revisa recursivamente todo el árbol de app/features/components de SOFIA
  // en busca de rutas HTTP que toquen esos dominios prohibidos. Cada patrón
  // exige que el segmento prohibido viva DENTRO de un literal de string
  // completo (misma comilla de apertura y cierre), permitiendo cualquier
  // prefijo de ruta antes, sin disparar falsos positivos sobre prosa.
  const forbiddenPathPatterns = [
    /(['"`])[a-z0-9\-/]*\/(checkout|orders?)\/[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*\/(pos|cash-sessions?|caja)\/[a-z0-9\-/]*\1/i,
    /(['"`])[a-z0-9\-/]*\/mark-?(as-)?paid[a-z0-9\-/]*\1/i,
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
      // Se despoja la interpolación de template literals (`${id}` -> ``) antes
      // de evaluar, para que una ruta construida dinámicamente
      // (`/admin/orders/${id}/checkout`) no evada el guard por la presencia
      // de caracteres `$`/`{`/`}` fuera de la clase de caracteres del regex.
      const source = readFileSync(filePath, 'utf8').replace(/\$\{[^}]*\}/g, '');
      for (const pattern of forbiddenPathPatterns) {
        assert.doesNotMatch(
          source,
          pattern,
          `${path.relative(root, filePath)} referencia una ruta prohibida (checkout/orders/pos/caja/mark-paid/whatsapp-send/payment-capture) — SOFIA nunca debe originar estas mutaciones`,
        );
      }
    }
  }
});

test('useMutation in the SOFIA/CRM tree is limited to the explicitly reviewed allowlist', () => {
  // Cada entrada de esta lista es una acción operada por un HUMANO
  // autenticado desde el panel admin (gobernanza, aprobación de comandos,
  // gestión de casos/leads/tareas/notas/campañas/segmentos/tags/
  // consentimientos/interacciones CRM) — ninguna crea pedidos/pagos reales
  // ni mueve stock/caja/checkout/POS/domicilios. Las 4 acciones de
  // gobernanza comparten un único useMutation privado
  // (useSofiaGovernanceAction); grantOptIn/revokeOptIn comparten otro
  // (useSofiaCrmConsentAction); todas las demás declaran el suyo propio.
  const allowedDirectMutationHooks = [
    'useSecureCommandApprove',
    'useSecureCommandReject',
    'useSofiaCustomerServiceTransition',
    'useSofiaCrmCreateSegment',
    'useSofiaCrmCreateLead',
    'useSofiaCrmTransitionLead',
    'useSofiaCrmCreateTask',
    'useSofiaCrmUpdateTask',
    'useSofiaCrmCreateNote',
    'useSofiaCrmCreateCampaign',
    'useSofiaCrmAttemptCampaignSend',
    'useSofiaCrmCreateTag',
    'useSofiaCrmAssignTag',
    'useSofiaCrmRecordInteraction',
  ];
  const queries = read('features', 'sofia', 'queries.ts');
  const totalUseMutation = (queries.match(/\buseMutation\(/g) ?? []).length;
  assert.equal(
    totalUseMutation,
    allowedDirectMutationHooks.length + 2,
    'queries.ts debe declarar useMutation exactamente (allowlist directa + 2 helpers privados: gobernanza y consentimientos)',
  );
  assert.match(queries, /function useSofiaGovernanceAction\(/);
  assert.match(queries, /function useSofiaCrmConsentAction\(/);
  for (const hook of allowedDirectMutationHooks) {
    assert.match(queries, new RegExp(`export function ${hook}\\(`), `falta el hook ${hook}`);
  }
  for (const hook of ['useSofiaPauseGlobal', 'useSofiaResumeGlobal', 'useSofiaActivateKillSwitch', 'useSofiaDeactivateKillSwitch']) {
    const start = queries.indexOf(`export function ${hook}(`);
    assert.notEqual(start, -1, `falta el hook ${hook}`);
    const body = queries.slice(start, start + 200);
    assert.match(body, /useSofiaGovernanceAction\(/, `${hook} debe delegar en useSofiaGovernanceAction, no declarar su propio useMutation`);
  }
  for (const hook of ['useSofiaCrmGrantOptIn', 'useSofiaCrmRevokeOptIn']) {
    const start = queries.indexOf(`export function ${hook}(`);
    assert.notEqual(start, -1, `falta el hook ${hook}`);
    const body = queries.slice(start, start + 200);
    assert.match(body, /useSofiaCrmConsentAction\(/, `${hook} debe delegar en useSofiaCrmConsentAction, no declarar su propio useMutation`);
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
      // Defensa adicional: ningún archivo fuera de queries.ts debe emitir una
      // llamada de escritura (POST/PATCH/PUT/DELETE) directamente — ni
      // siquiera fuera de useMutation (ej. dentro de un onClick con
      // apiFetchSchema/fetch crudo) — toda mutación debe pasar por un hook
      // revisado en queries.ts.
      assert.doesNotMatch(
        source,
        /method:\s*['"](POST|PATCH|PUT|DELETE)['"]/,
        `${path.relative(root, filePath)} emite una llamada de escritura fuera de queries.ts — toda mutación debe pasar por un hook revisado`,
      );
    }
  }
});
