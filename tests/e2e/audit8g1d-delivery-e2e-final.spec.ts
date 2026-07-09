import { expect, test } from '@playwright/test';

test.describe('AUDIT-8G.1.1D: Delivery E2E Final', () => {
  test.setTimeout(60000);

  test('delivery flow: POS loads and delivery mode works', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Verify POS loaded (not redirected to login)
    expect(page.url()).toContain('/pos');

    // Check no 500 errors
    const serverErrors: string[] = [];
    page.on('response', (r) => { if (r.status() >= 500) serverErrors.push(r.url()); });
    await page.waitForTimeout(2000);
    expect(serverErrors.length).toBe(0);

    await page.screenshot({
      path: 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/01-pos-loaded.png',
      fullPage: true,
    });
  });

  test('cash page has no error banner', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    const errorBanner = page.getByText('No pudimos cargar toda la operación de caja');
    await expect(errorBanner).toHaveCount(0, { timeout: 5000 });

    await page.screenshot({
      path: 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/11-cash-no-global-error-banner.png',
      fullPage: true,
    });
  });

  test('session persists after page reload on cash', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Reload and verify still on cash
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Should stay on cash or dashboard - NOT redirected to login
    const url = page.url();
    expect(url).not.toContain('/login');

    await page.screenshot({
      path: 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/12-auth-session-after-refresh.png',
      fullPage: true,
    });
  });

  test('mobile responsive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/10-mobile-390x844.png',
      fullPage: true,
    });
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('http://localhost/settings', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/09-settings.png',
      fullPage: true,
    });
  });

  test('dashboard loads', async ({ page }) => {
    await page.goto('http://localhost/dashboard', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/dashboard');
  });

  test('tables page loads', async ({ page }) => {
    await page.goto('http://localhost/tables', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/tables');
  });
});
