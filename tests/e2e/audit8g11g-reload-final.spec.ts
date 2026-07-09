import { expect, test } from '@playwright/test';

// Uses storageState from auth.setup.ts — NO individual logins, NO rate limit

test.describe('AUDIT-8G.1.1G: Protected Routes Reload', () => {
  test.setTimeout(60000);

  test('cash reload: no redirect, no error banner', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Verify cookie exists
    const cookies = await page.context().cookies('http://localhost');
    const refreshCookie = cookies.find((c) => c.name === 'refresh_token');
    expect(refreshCookie).toBeDefined();

    // RELOAD
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Should NOT be on login
    expect(page.url()).not.toContain('/login');

    // No error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0, { timeout: 5000 });
  });

  test('dashboard reload: no redirect', async ({ page }) => {
    await page.goto('http://localhost/dashboard', { waitUntil: 'networkidle', timeout: 15000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/login');
  });

  test('tables reload: no redirect', async ({ page }) => {
    await page.goto('http://localhost/tables', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/login');
  });

  test('pos reload: no redirect', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/login');
  });

  test('settings reload: no redirect', async ({ page }) => {
    await page.goto('http://localhost/settings', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/login');
  });
});
