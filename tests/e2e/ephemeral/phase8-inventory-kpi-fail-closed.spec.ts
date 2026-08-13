import { expect, test } from '../fixtures/worker-auth';

const unavailable = {
  status: 503,
  contentType: 'application/json',
  body: JSON.stringify({ message: 'authoritative source unavailable' }),
};

test.describe('Phase 8 inventory and KPI UI fails closed', () => {
  test('inventory distinguishes unavailable sources from verified empty states', async ({ page }) => {
    for (const endpoint of [
      'inventory/stock',
      'inventory/movements**',
      'inventory/reorder-suggestions',
      'inventory/stock-counts/preview**',
      'inventory/stock-counts',
    ]) {
      await page.route(`**/api/${endpoint}`, (route) => route.fulfill(unavailable));
    }

    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('No pudimos verificar el stock crítico')).toBeVisible();
    await expect(page.getByText('No pudimos verificar los conteos')).toBeVisible();
    await expect(page.getByText('No pudimos verificar los movimientos')).toBeVisible();
    await expect(page.getByText('No pudimos calcular la compra sugerida')).toBeVisible();
    await expect(page.getByText('Todo en orden.')).toHaveCount(0);
    await expect(page.getByText('Sin conteos', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sin movimientos todavía', { exact: true })).toHaveCount(0);
  });

  test('team metrics remain unavailable when the user source fails', async ({ page }) => {
    await page.route('**/api/users', (route) => route.fulfill(unavailable));

    await page.goto('/team', { waitUntil: 'domcontentloaded' });

    await expect(page.getByLabel('Integrantes')).toContainText('No disponible');
    await expect(page.getByLabel('Accesos activos')).toContainText('No disponible');
    await expect(page.getByLabel('Equipo operativo')).toContainText('No disponible');
    await expect(page.getByLabel('Desactivados')).toContainText('No disponible');
  });

  test('catalog headers do not report zero while their sources fail', async ({ page }) => {
    await page.route('**/api/categories', (route) => route.fulfill(unavailable));
    await page.goto('/categories', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Categorías sin verificar')).toBeVisible();
    await expect(page.getByText('0 categorías', { exact: true })).toHaveCount(0);

    await page.route('**/api/products', (route) => route.fulfill(unavailable));
    await page.route('**/api/ingredients', (route) => route.fulfill(unavailable));
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Recetas sin verificar')).toBeVisible();
    await expect(page.getByText('0 configurables', { exact: true })).toHaveCount(0);
  });
});
