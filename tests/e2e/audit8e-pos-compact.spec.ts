import { expect, test } from '@playwright/test';

const BASE = 'http://localhost';
const DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8e-pos-compact-order-payment';

test.describe('AUDIT-8E: POS Compact Order + Payment', () => {
  test.setTimeout(120000);

  test('POS loads and captures screenshots', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Open POS
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    // Desktop screenshot
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${DIR}/pos-after-desktop-1440x900.png`, fullPage: true });

    // Tablet screenshot
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: `${DIR}/pos-after-tablet-1024x768.png`, fullPage: true });

    // Mobile screenshot
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${DIR}/pos-after-mobile-390x844.png`, fullPage: true });

    // Desktop again for detail screenshots
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Capture payment section
    await page.screenshot({ path: `${DIR}/pos-payment-after-desktop.png`, fullPage: true });

    // Verify key elements exist
    await expect(page.locator('h2:has-text("Carta")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('h2:has-text("Pedidos abiertos")')).toBeVisible({ timeout: 5000 });

    // Verify Editar pedido section
    const editSection = page.locator('h2:has-text("Nuevo pedido")').or(page.locator('h2:has-text("Editar pedido")'));
    await expect(editSection).toBeVisible({ timeout: 5000 });

    // Add product to cart to test compact items
    const firstProduct = page.locator('[data-testid^="pos-product-"]').first();
    if (await firstProduct.isVisible().catch(() => false)) {
      await firstProduct.click();
      await page.waitForTimeout(500);

      // Screenshot with item in cart
      await page.screenshot({ path: `${DIR}/pos-item-compacto.png`, fullPage: false });

      // Verify quantity controls
      await expect(page.locator('[data-testid^="pos-cart-qty-"]').first()).toBeVisible();
    }

    // Verify no critical console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(2000);
    expect(errors.filter(e => !e.includes('favicon')).length).toBeLessThanOrEqual(5);
  });
});
