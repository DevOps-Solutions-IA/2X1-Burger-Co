import { expect, test } from '@playwright/test';
import { captureBrowserErrors, expectAccessiblePage } from './accessibility';

test('mobile login and dashboard do not overflow horizontally', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await page.goto('/login');
  await page.getByTestId('login-email').fill(process.env.EPHEMERAL_ADMIN_EMAIL!);
  await page.getByTestId('login-password').fill(process.env.EPHEMERAL_ADMIN_PASSWORD!);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expectAccessiblePage(page);

  await page.goto('/sofia/customers');
  await expect(page).toHaveURL(/\/customers\/?$/, { timeout: 20_000 });
  await expect(page.getByTestId('customers-page')).toBeVisible({ timeout: 20_000 });
  const crmDimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(crmDimensions.scrollWidth).toBeLessThanOrEqual(crmDimensions.width + 1);
  const searchButton = page.getByRole('button', { name: 'Buscar' });
  await expect(searchButton).toBeEnabled();
  await expect(searchButton).toHaveCSS('opacity', '1');
  await expectAccessiblePage(page);
  expect(browserErrors).toEqual([]);
});
