import { expect, test } from './fixtures/worker-auth';

async function waitForCashReady(page: import('@playwright/test').Page) {
  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await expect(page, 'cash redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('cash-daily-summary-card')).toBeVisible({ timeout: 15000 });
}

test.describe('cash revenue enterprise reconciliation', () => {
  test('cash page exposes physical cash, digital revenue and operating result separately', async ({ page }) => {
    await waitForCashReady(page);

    await expect(page.getByText('Caja física esperada').first()).toBeVisible();
    await expect(page.getByText('Recaudo digital').first()).toBeVisible();
    await expect(page.getByText('Total recaudado').first()).toBeVisible();
    await expect(page.getByText('Resultado operativo').first()).toBeVisible();
    await expect(page.getByText('Diferencia efectivo').first()).toBeVisible();

    await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);
  });
});
