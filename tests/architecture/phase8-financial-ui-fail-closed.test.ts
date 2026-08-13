import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function pageSource(name: 'cash' | 'reports' | 'inventory' | 'categories' | 'recipes') {
  return readFileSync(resolve(repositoryRoot, `apps/web/src/app/(app)/${name}/page.tsx`), 'utf8');
}

test('cash financial evidence is gated by successful sources', () => {
  const cash = pageSource('cash');

  assert.match(cash, /const financialSummaryAvailable =/);
  assert.match(cash, /Boolean\(cashDailySummary\.data\)/);
  assert.match(cash, /financialSummaryAvailable \? \(/);
  assert.match(cash, /data-testid="cash-daily-summary-values"/);
  assert.match(cash, /data-testid="cash-use-expected"[\s\S]*?disabled=\{financialMetricsUnavailable\}/);
  assert.match(cash, /sales\.isError \? \(/);
  assert.match(cash, /sales\.isSuccess && sales\.data\.length === 0/);
  assert.match(cash, /const closeChecklistAvailable = Boolean\(closeChecklist\.data\) && !closeChecklist\.error/);
  assert.match(cash, /data-testid="cash-close-checklist-values"/);
  assert.match(cash, /data-testid="cash-close-checklist-unavailable"/);
  assert.match(cash, /closeChecklistAvailable \? \([\s\S]*?value=\{closeChecklist\.data\?\.activeOrdersCount \?\? 0\}[\s\S]*?cash-close-checklist-unavailable/);
});

test('inventory empty and success claims require authoritative query results', () => {
  const inventory = pageSource('inventory');

  assert.match(inventory, /reorderSuggestions\.isError \? 'error' : criticalAlerts\.length \? 'ready' : 'empty'/);
  assert.match(inventory, /stockCounts\.isError \? 'error' : stockCounts\.data\?\.length \? 'ready' : 'empty'/);
  assert.match(inventory, /movements\.isError \? 'error' : movements\.data\?\.length \? 'ready' : 'empty'/);
  assert.match(inventory, /La fuente de reposición no está disponible; no asumimos que el inventario está en orden/);
  assert.doesNotMatch(inventory, /\?\? 0\}<\/Badge>/);
});

test('team and catalog counters do not fabricate zero while their sources are unavailable', () => {
  const team = readFileSync(resolve(repositoryRoot, 'apps/web/src/features/governance/team-workspace.tsx'), 'utf8');
  const categories = pageSource('categories');
  const recipes = pageSource('recipes');

  assert.match(team, /const counts = useMemo\(\(\) => users\.data && !users\.isError \? \(\{/);
  assert.match(team, /value=\{counts\?\.total\} unavailable=\{!counts\}/);
  assert.match(categories, /label="Categorías sin verificar"/);
  assert.match(recipes, /const catalogAvailable = Boolean\(products\.data\) && Boolean\(ingredients\.data\)/);
  assert.match(recipes, /label="Recetas sin verificar"/);
});

test('reports renders detail only for validated summary data', () => {
  const reports = pageSource('reports');

  assert.match(reports, /const summaryAvailable = Boolean\(summary\.data\) && !summary\.isError/);
  assert.match(reports, /summaryAvailable \? \(/);
  assert.match(reports, /data-testid="reports-financial-detail-unavailable"/);
  assert.match(reports, /salesByHour\.isError \? \(/);
  assert.match(reports, /productMargins\.isError \? \(/);
  assert.match(reports, /comparisons\.isError \? \(/);
});

test('cash sale actions retain at least 44px touch targets', () => {
  const cash = pageSource('cash');

  assert.doesNotMatch(cash, /className="h-9 (?:w-9|min-w-0) rounded-full/);
  assert.equal((cash.match(/className="h-11 w-11 min-w-0 rounded-full p-0"/g) ?? []).length, 2);
  assert.equal((cash.match(/className="min-h-11 min-w-0 rounded-full px-3 text-\[11px\]"/g) ?? []).length, 2);
});
