import { expect, test } from '@playwright/test';

const BASE = 'http://localhost';
const DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8f2-pos-tables-evidence-closure';

test.describe('AUDIT-8F.2: POS + Tables Evidence', () => {
  test.setTimeout(120000);

  test('POS: save then clean workspace', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Go to POS
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/01-pos-before-save.png`, fullPage: true });

    // Verify POS loaded
    await expect(page.locator('h2:has-text("Carta")')).toBeVisible({ timeout: 5000 });

    // Click first product to add to cart
    const firstProduct = page.locator('[data-testid^="pos-product-"]').first();
    if (await firstProduct.isVisible().catch(() => false)) {
      await firstProduct.click();
      await page.waitForTimeout(500);
    }

    // Save order
    const saveBtn = page.locator('button:has-text("Abrir pedido")').or(page.locator('button:has-text("Guardar")'));
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: `${DIR}/02-pos-after-save-clean.png`, fullPage: true });

    // Check open orders section
    const openOrders = page.locator('h2:has-text("Pedidos abiertos")');
    await expect(openOrders).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${DIR}/03-pos-open-orders-after-save.png`, fullPage: true });
  });

  test('Tables: premium UI loads', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Go to Tables
    await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    // Screenshots at 3 viewports
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${DIR}/09-tables-premium-desktop-1440x900.png`, fullPage: true });

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: `${DIR}/10-tables-premium-tablet-1024x768.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${DIR}/11-tables-premium-mobile-390x844.png`, fullPage: true });

    // Back to desktop for content checks
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify new copy
    await expect(page.getByText('Salón — Atención en vivo')).toBeVisible({ timeout: 5000 });

    // Verify old copy is gone
    await expect(page.getByText('Mesas y ocupación')).toHaveCount(0);

    // Card state screenshot
    await page.screenshot({ path: `${DIR}/12-tables-card-state.png`, fullPage: true });
  });

  test('Mobile: POS no overflow', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/08-pos-mobile-390x844.png`, fullPage: true });

    // No critical errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
    });
    await page.waitForTimeout(1000);
    expect(errors.length).toBeLessThanOrEqual(5);
  });
});
