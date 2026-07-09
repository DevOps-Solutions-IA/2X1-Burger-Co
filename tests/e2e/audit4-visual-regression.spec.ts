import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-4';
const BASE = 'http://localhost';

async function loginAsAdmin(page: any) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('login-email').fill('admin@2x1burgerco.local');
  await page.getByTestId('login-password').fill('DevAdmin12345*');
  await page.getByTestId('login-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

test.describe('AUDIT-4: Visual Regression', () => {
  test.setTimeout(120000);

  test('all critical pages load and render', async ({ page }) => {
    await loginAsAdmin(page);

    const pages = [
      'dashboard', 'cash', 'pos', 'tables', 'deliveries', 'inventory',
      'products', 'purchases', 'expenses', 'reports', 'users'
    ];

    for (const path of pages) {
      await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${path}-desktop.png`, fullPage: false });

      // Verify no error banner
      const errorBanner = page.getByText('No pudimos cargar');
      await expect(errorBanner).toHaveCount(0);
    }
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/login-desktop.png`, fullPage: false });

    // Verify login form is present
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('cash page has no error banner', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/cash`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Critical check: no error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0);

    // Page title visible
    await expect(page.getByText('Operación de caja')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/cash-clean.png`, fullPage: false });
  });
});
