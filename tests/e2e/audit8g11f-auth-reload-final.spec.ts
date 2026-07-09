import { expect, test } from '@playwright/test';

test.describe('AUDIT-8G.1.1F: Auth Reload Final', () => {
  test.setTimeout(60000);

  test('session restores after page reload on cash', async ({ page }) => {
    // Login via UI
    await page.goto('http://localhost/login', { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Go to cash
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Verify cookie exists
    const cookies = await page.context().cookies('http://localhost');
    const refreshCookie = cookies.find((c) => c.name === 'refresh_token');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie!.httpOnly).toBe(true);
    expect(refreshCookie!.path).toBe('/api/auth');

    // RELOAD the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Should NOT be on login
    const url = page.url();
    expect(url).not.toContain('/login');

    // Cash page should be visible
    const cashTitle = page.getByText('Caja').first();
    await expect(cashTitle).toBeVisible({ timeout: 5000 });

    // No error banner
    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0);
  });

  test('session restores after reload on dashboard', async ({ page }) => {
    await page.goto('http://localhost/login', { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    expect(page.url()).not.toContain('/login');
  });

  test('session restores after reload on tables', async ({ page }) => {
    await page.goto('http://localhost/login', { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.goto('http://localhost/tables', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    expect(page.url()).not.toContain('/login');
  });
});
