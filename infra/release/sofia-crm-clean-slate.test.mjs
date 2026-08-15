import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const web = (...segments) => path.join(root, 'apps', 'web', 'src', ...segments);
const read = (...segments) => readFileSync(web(...segments), 'utf8');

const cleanRoutes = [
  ['app', '(app)', 'sofia', 'page.tsx'],
  ['app', '(app)', 'sofia', 'crm', 'page.tsx'],
  ['app', '(app)', 'sofia', 'whatsapp-qr', 'page.tsx'],
];

const rejectedComponents = [
  'SofiaActionMatrix.tsx',
  'SofiaBlockerChecklist.tsx',
  'SofiaCommandCard.tsx',
  'SofiaConversationCard.tsx',
  'SofiaOperatorConsole.tsx',
  'SofiaPageHero.tsx',
  'SofiaPageShell.tsx',
  'SofiaReadinessGauge.tsx',
  'SofiaSectionCard.tsx',
  'SofiaStatusPill.tsx',
  'SofiaTimeline.tsx',
];

test('SOFIA and CRM routes remain neutral clean-slate boundaries', () => {
  for (const route of cleanRoutes) {
    const source = read(...route);
    assert.match(source, /SofiaCleanSlatePlaceholder/);
    assert.doesNotMatch(source, /useSofia[A-Z]|apiFetchSchema|useMutation|mock|sample/i);
  }

  assert.match(read('app', '(app)', 'sofia', 'conversations', 'page.tsx'), /redirect\('\/sofia'\)/);
  assert.match(read('app', '(app)', 'sofia', 'customers', 'page.tsx'), /redirect\('\/sofia\/crm'\)/);
  assert.match(read('app', '(app)', 'sofia', 'customers', '[customerId]', 'page.tsx'), /redirect\('\/sofia\/crm'\)/);
});

test('rejected visual component family is absent from active SOFIA routes', () => {
  const componentDirectory = web('components', 'sofia');
  const activeComponents = readdirSync(componentDirectory);
  assert.deepEqual(activeComponents, ['SofiaCleanSlatePlaceholder.tsx']);

  for (const component of rejectedComponents) {
    assert.equal(existsSync(path.join(componentDirectory, component)), false, `${component} must stay removed`);
  }
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
