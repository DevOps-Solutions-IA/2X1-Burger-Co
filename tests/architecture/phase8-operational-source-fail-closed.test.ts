import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function source(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('POS verifies authoritative operational sources before save or checkout', () => {
  const pos = source('apps/web/src/app/(app)/pos/page.tsx');

  assert.match(pos, /const operationalSourcesReady =[\s\S]*?currentCash\.isSuccess[\s\S]*?products\.isSuccess[\s\S]*?paymentMethods\.isSuccess[\s\S]*?tables\.isSuccess/);
  assert.match(pos, /const operationalSourcesUnavailable =[\s\S]*?currentCash\.isError[\s\S]*?products\.isError[\s\S]*?paymentMethods\.isError[\s\S]*?tables\.isError/);
  assert.match(pos, /mutationFn: async \(\) => \{[\s\S]*?if \(!operationalSourcesReady\)[\s\S]*?No se puede guardar la comanda/);
  assert.match(pos, /onCheckoutOrder=\{\(\) => \{[\s\S]*?if \(!operationalSourcesReady\)[\s\S]*?checkoutOrder\.mutate\(\)/);
});

test('purchase and expense writes reject unavailable dependencies even with cached data', () => {
  const purchases = source('apps/web/src/app/(app)/purchases/page.tsx');
  const expenses = source('apps/web/src/app/(app)/expenses/page.tsx');

  assert.match(purchases, /const purchaseSourcesReady =[\s\S]*?suppliers\.isSuccess[\s\S]*?ingredients\.isSuccess[\s\S]*?products\.isSuccess[\s\S]*?paymentMethods\.isSuccess/);
  assert.match(purchases, /mutationFn: \(\) => \{[\s\S]*?if \(!purchaseSourcesReady\)[\s\S]*?Promise\.reject/);
  assert.match(purchases, /data-testid="purchase-submit"[\s\S]*?disabled=\{!canCreate \|\| createPurchase\.isPending \|\| !purchaseSourcesReady\}/);

  assert.match(expenses, /const expenseSourcesReady = dailySummary\.isSuccess && paymentMethods\.isSuccess/);
  assert.match(expenses, /mutationFn: \(\) => \{[\s\S]*?if \(!expenseSourcesReady\)[\s\S]*?Promise\.reject/);
  assert.match(expenses, /data-testid="expense-submit"[\s\S]*?disabled=\{!canCreate \|\| createExpense\.isPending \|\| !expenseSourcesReady\}/);
});

test('operational headers never present cached or failed sources as connected', () => {
  const orders = source('apps/web/src/features/order-operations/orders-screen.tsx');
  const kitchen = source('apps/web/src/features/order-operations/kitchen-screen.tsx');

  assert.match(orders, /const sourceStatus = result\.isError[\s\S]*?Datos desactualizados[\s\S]*?: result\.isFetching[\s\S]*?: result\.isSuccess[\s\S]*?Datos operativos/);
  assert.match(kitchen, /const sourceStatus = result\.isError[\s\S]*?Cola desactualizada[\s\S]*?: result\.isFetching[\s\S]*?: result\.isSuccess[\s\S]*?Cola conectada/);
});

test('catalog counters disclose unavailable or stale authority and supplier switches are touch safe', () => {
  const products = source('apps/web/src/app/(app)/products/page.tsx');
  const ingredients = source('apps/web/src/app/(app)/ingredients/page.tsx');
  const suppliers = source('apps/web/src/app/(app)/suppliers/page.tsx');
  const tables = source('apps/web/src/app/(app)/tables/page.tsx');
  const purchases = source('apps/web/src/app/(app)/purchases/page.tsx');

  assert.match(products, /products\.isError[\s\S]*?Catálogo desactualizado[\s\S]*?Catálogo sin verificar/);
  assert.match(ingredients, /ingredients\.isError[\s\S]*?Insumos desactualizados[\s\S]*?Insumos sin verificar/);
  assert.match(suppliers, /suppliers\.data && !suppliers\.isError[\s\S]*?Directorio desactualizado[\s\S]*?Directorio sin verificar/);
  assert.match(tables, /tables\.data && !tables\.isError[\s\S]*?Salón desactualizado[\s\S]*?Salón sin verificar/);
  assert.equal((purchases.match(/inline-flex min-h-11 min-w-11[^"]*focus-visible:ring-2/g) ?? []).length, 2);
});

test('financial history never turns source failure into empty or fabricated evidence', () => {
  const cash = source('apps/web/src/app/(app)/cash/page.tsx');
  const reports = source('apps/web/src/app/(app)/reports/page.tsx');

  assert.match(cash, /history\.isError[\s\S]*?Historial de caja no disponible[\s\S]*?history\.refetch/);
  assert.match(cash, /!history\.isError && !history\.isLoading && history\.data\?\.length/);
  assert.doesNotMatch(reports, /id: isCurrentSession \? 'operational-live'/);
  assert.doesNotMatch(reports, /new Date\(\)\.toISOString\(\)/);
  assert.match(reports, /closures\.isError[\s\S]*?Histórico no disponible[\s\S]*?closures\.refetch/);
  assert.match(reports, /Sin cierres en el rango/);
  assert.match(reports, /supplyAlerts\.isError[\s\S]*?Abastecimiento no disponible/);
  assert.match(reports, /supplierNotifications\.isError[\s\S]*?Notificaciones no disponibles/);
  assert.match(reports, /const canExportReports = hasPermission\(user\?\.permissions, 'reports\.pdf'\)/);
  assert.match(reports, /<div key=\{closure\.id\}[\s\S]*?\{canExportReports \? \([\s\S]*?Reimprimir[\s\S]*?\) : \([\s\S]*?Sin permiso PDF/);
});
