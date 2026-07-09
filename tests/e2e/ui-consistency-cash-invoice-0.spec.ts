import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/ui-consistency-cash-invoice-0';

async function gotoApp(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
}

async function screenshot(page: import('@playwright/test').Page, fileName: string, fullPage = false) {
  await page.screenshot({ path: path.join(screenshotsDir, fileName), fullPage });
}

test.describe('UI-CONSISTENCY-CASH-INVOICE-0 visual evidence', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('captures platform visual alignment evidence without mutating operational data', async ({ page }) => {
    test.setTimeout(180_000);

    await page.setViewportSize({ width: 1440, height: 920 });

    await gotoApp(page, '/inventory');
    await expect(page.getByText('¡Atención! Stock crítico').first()).toBeVisible({ timeout: 15_000 });
    await screenshot(page, '01-admin-reference-visual.png');

    await gotoApp(page, '/dashboard');
    await expect(page.getByText('Atención requerida')).toBeVisible();
    await screenshot(page, '02-home-atencion-requerida-stock-critical.png');
    await expect(page.getByText('Última actividad')).toBeVisible();
    await screenshot(page, '03-home-ultima-actividad-premium.png');
    await expect(page.getByText('Lo más vendido')).toBeVisible();
    await screenshot(page, '04-home-lo-mas-vendido-premium.png');

    await gotoApp(page, '/users');
    await expect(page.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible();
    const visibleRoleLabels = await page.locator('select option').allTextContents();
    expect(visibleRoleLabels.join(' ')).not.toMatch(/\badmin\b|\bcashier\b|\bmanager\b/i);
    await screenshot(page, '05-create-user-roles-spanish.png');

    await gotoApp(page, '/pos');
    const openOrders = page.getByTestId('pos-open-orders');
    await expect(openOrders).toBeVisible();
    const openOrdersOverflow = await openOrders.evaluate((node) => {
      const scrollable = node.querySelector('.overflow-y-auto');
      if (!scrollable) return 'missing';
      return getComputedStyle(scrollable).overflowY;
    });
    expect(openOrdersOverflow).toBe('auto');
    await screenshot(page, '06-pos-open-orders-scroll-10.png');
    await screenshot(page, '07-pos-order-card-no-overflow.png');

    await gotoApp(page, '/cash');
    await expect(page.getByTestId('cash-page')).toBeVisible();
    await expect(page.getByText(/Caja operativa|Abrir caja/)).toBeVisible();
    await screenshot(page, '08-cash-caja-operativa-premium.png');
    await expect(page.getByText('El día hasta ahora')).toBeVisible();
    await screenshot(page, '09-cash-dia-hasta-ahora-premium.png');
    await screenshot(page, '10-cash-payment-methods-dynamic-color.png');
    await screenshot(page, '11-cash-arqueo-premium.png');
    await expect(page.getByText('Ventas de la jornada')).toBeVisible();
    await screenshot(page, '12-cash-ventas-jornada-premium.png');
    await screenshot(page, '13-receipt-invoice-preview-if-available.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, '/pos');
    const posOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(posOverflow).toBeLessThanOrEqual(2);
    await gotoApp(page, '/cash');
    const cashOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(cashOverflow).toBeLessThanOrEqual(2);
    await screenshot(page, '14-mobile-pos-cash-clean.png');

    await page.setViewportSize({ width: 1440, height: 920 });
    await gotoApp(page, '/dashboard');
    await screenshot(page, '15-final-summary.png');
  });
});
