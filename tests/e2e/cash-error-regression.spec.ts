import { expect, test } from '@playwright/test';

const BASE = 'http://localhost';

test.describe('AUDIT-3C: Cash Error Zero Tolerance', () => {
  test('Cash page loads without global error banner', async ({ page }) => {
    // 1. Login
    await page.goto(`${BASE}/login`);
    await page.getByTestId('login-email').fill('admin@2x1burgerco.local');
    await page.getByTestId('login-password').fill('DevAdmin12345*');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15000 });

    // 2. Navigate to Cash
    await page.goto(`${BASE}/cash`);
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    // 3. Take screenshot
    const screenshotDir = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/after';
    await page.screenshot({ path: `${screenshotDir}/cash-audit3c-after.png`, fullPage: true });

    // 4. Verify NO global error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0, { timeout: 5000 });

    // 5. Verify page title is visible
    await expect(page.getByText('Operación de caja')).toBeVisible({ timeout: 5000 });

    // 6. Verify cash status badge is visible (use first() to avoid strict mode on multiple matches)
    const badge = page.getByText(/Caja abierta|Caja cerrada|Pendiente apertura/).first();
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test('Cash page shows open cash session when exists', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByTestId('login-email').fill('admin@2x1burgerco.local');
    await page.getByTestId('login-password').fill('DevAdmin12345*');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15000 });

    await page.goto(`${BASE}/cash`);
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    // Cash is open from seed - verify badge (use first() to handle multiple matches)
    await expect(page.getByText('Caja abierta').first()).toBeVisible({ timeout: 5000 });

    // "Abrir caja" should NOT be shown when cash is open
    await expect(page.locator('h2:has-text("Abrir caja")')).toHaveCount(0);

    // Take screenshot
    const dir = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/after';
    await page.screenshot({ path: `${dir}/cash-audit3c-open-session.png`, fullPage: true });
  });
});
