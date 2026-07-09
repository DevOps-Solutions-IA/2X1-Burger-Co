import { expect, test } from '@playwright/test';

const BASE = 'http://localhost';

test.describe('AUDIT-8G.1.1B: Auth + Cash Stability', () => {
  test.setTimeout(120000);

  test('auth session persists after page refresh', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Go to POS
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('h2:has-text("Carta")')).toBeVisible({ timeout: 5000 });

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Should still be on POS, not redirected to login
    expect(page.url()).toContain('/pos');

    // Go to Cash
    await page.goto(`${BASE}/cash`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Should be on cash, not login
    expect(page.url()).toContain('/cash');

    // Refresh cash
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/cash');
  });

  test('cash page loads without global error banner', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.goto(`${BASE}/cash`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Critical check: NO global error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0, { timeout: 5000 });

    // Verify cash page is functional
    const cashTitle = page.getByText('Caja — Jornada en vivo');
    await expect(cashTitle).toBeVisible({ timeout: 5000 });

    // Capture failed requests
    const failedRequests: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 500) {
        failedRequests.push(`${response.url()} -> ${response.status()}`);
      }
    });
    await page.waitForTimeout(2000);
    expect(failedRequests.length).toBe(0);
  });

  test('cash page shows operational state', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.goto(`${BASE}/cash`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Should show cash state badge
    const cashBadge = page.getByText(/Caja abierta|Caja cerrada|Pendiente apertura/).first();
    await expect(cashBadge).toBeVisible({ timeout: 5000 });

    // Key metrics should be visible
    await expect(page.getByText('Ventas del día').or(page.getByText('Ventas hoy'))).toBeVisible({ timeout: 5000 });

    // No error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0);
  });
});
