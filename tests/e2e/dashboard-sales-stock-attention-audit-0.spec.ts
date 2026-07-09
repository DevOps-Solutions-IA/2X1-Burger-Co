import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-dashboard-sales-stock-attention-audit-0';

function countStockAlerts(replenishment: any) {
  const products = [
    ...(replenishment?.productOutOfStock ?? []),
    ...(replenishment?.productCriticalStock ?? []),
    ...(replenishment?.productLowStock ?? []),
  ];
  const ingredients = [
    ...(replenishment?.outOfStock ?? []),
    ...(replenishment?.criticalStock ?? []),
    ...(replenishment?.lowStock ?? []),
  ];
  return {
    products: new Set(products.map((item: any) => item.productId)).size,
    ingredients: new Set(ingredients.map((item: any) => item.ingredientId)).size,
  };
}

async function screenshot(page: import('@playwright/test').Page, fileName: string, fullPage = false) {
  await page.screenshot({ path: path.join(screenshotsDir, fileName), fullPage });
}

test.describe('CODEX-DASHBOARD-SALES-STOCK-ATTENTION-AUDIT-0', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('dashboard sales counters and stock attention use operational summary consistently', async ({
    page,
    request,
    workerAccessToken,
  }) => {
    const reportResponse = await request.get('/api/reports/operational', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
    });
    expect(reportResponse.ok()).toBeTruthy();
    const report = await reportResponse.json();
    const expected = countStockAlerts(report.replenishment);
    const expectedTotal = expected.products + expected.ingredients;

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page, '/dashboard redirected to login').not.toHaveURL(/\/login/);
    await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('topbar-items-sold')).toContainText(
      `${Number(report.sales.itemsSold ?? 0)} unidades vendidas hoy`,
    );
    await expect(page.getByText(`${Number(report.sales.count ?? 0)} ventas registradas`)).toBeVisible();
    await expect(page.getByText('vendidos hoy')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/undefined|null|NaN/);
    await screenshot(page, '01-dashboard-sales-count-consistent.png', true);
    await screenshot(page, '02-topbar-vs-status-day-same-source.png');

    await expect(page.getByTestId('attention-tab-all')).toContainText(`Todos (${expectedTotal})`);
    await expect(page.getByTestId('attention-tab-products')).toContainText(`Productos (${expected.products})`);
    await expect(page.getByTestId('attention-tab-ingredients')).toContainText(`Insumos (${expected.ingredients})`);

    await page.getByTestId('attention-tab-all').click();
    await screenshot(page, '03-attention-required-all.png');

    await page.getByTestId('attention-tab-products').click();
    if (expected.products > 0) {
      await expect(page.getByTestId('attention-card-product').first()).toBeVisible();
    }
    await expect(page.getByTestId('attention-card-ingredient')).toHaveCount(0);
    await screenshot(page, '04-attention-required-products.png');

    await page.getByTestId('attention-tab-ingredients').click();
    if (expected.ingredients > 0) {
      await expect(page.getByTestId('attention-card-ingredient').first()).toBeVisible();
    }
    await expect(page.getByTestId('attention-card-product')).toHaveCount(0);
    await screenshot(page, '05-attention-required-ingredients.png');

    await page.getByTestId('attention-tab-products').click();
    await screenshot(page, '06-critical-product-red-state.png');
    await page.getByTestId('attention-tab-ingredients').click();
    await screenshot(page, '07-critical-ingredient-red-state.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('attention-tabs')).toBeVisible();
    await screenshot(page, '08-dashboard-mobile-attention-tabs.png', true);

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await screenshot(page, '09-final-dashboard-summary.png', true);
  });
});
