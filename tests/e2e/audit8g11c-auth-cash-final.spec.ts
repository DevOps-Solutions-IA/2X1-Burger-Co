import { expect, test } from '@playwright/test';

test.describe('AUDIT-8G.1.1C: Auth + Cash Final', () => {
  test.setTimeout(60000);

  test('cash page loads without global error banner', async ({ page }) => {
    // Already authenticated via storageState from auth.setup.ts
    await page.goto('/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Critical: NO global error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0, { timeout: 5000 });

    // Cash page is functional
    await expect(page.getByText('Caja').first()).toBeVisible({ timeout: 5000 });

    // No 500 errors
    const errors: string[] = [];
    page.on('response', (r) => { if (r.status() >= 500) errors.push(r.url()); });
    await page.waitForTimeout(2000);
    expect(errors.length).toBe(0);
  });

  test('session persists after page refresh', async ({ page }) => {
    await page.goto('/cash', { waitUntil: 'networkidle', timeout: 20000 });

    // Refresh the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Should still be on cash, not redirected to login
    expect(page.url()).toContain('/cash');
    await expect(page.getByText('Caja').first()).toBeVisible({ timeout: 5000 });
  });

  test('POS page loads correctly', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    await expect(page.locator('h2:has-text("Carta")')).toBeVisible({ timeout: 5000 });
  });
});
