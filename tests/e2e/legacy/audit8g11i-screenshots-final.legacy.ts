import { expect, test } from '@playwright/test';

const DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine';

test.describe('AUDIT-8G.1.1I: Screenshots', () => {
  test.setTimeout(30000);

  test('11-cash-no-global-error-banner', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/11-cash-no-global-error-banner.png`, fullPage: true });
  });

  test('12-auth-session-after-refresh', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/12-auth-session-after-refresh.png`, fullPage: true });
  });

  test('13-dashboard-after-refresh', async ({ page }) => {
    await page.goto('http://localhost/dashboard', { waitUntil: 'networkidle', timeout: 15000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/13-dashboard-after-refresh.png`, fullPage: true });
  });

  test('14-tables-after-refresh', async ({ page }) => {
    await page.goto('http://localhost/tables', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/14-tables-after-refresh.png`, fullPage: true });
  });

  test('15-pos-after-refresh', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/15-pos-after-refresh.png`, fullPage: true });
  });

  test('03-pos-delivery-manual-quote', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/03-pos-delivery-ambiguous-needs-manual.png`, fullPage: true });
  });

  test('09-settings', async ({ page }) => {
    await page.goto('http://localhost/settings', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/09-settings-origin-pending-or-configured.png`, fullPage: true });
  });

  test('10-mobile-390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/10-mobile-390x844.png`, fullPage: true });
  });

  test('04-manual-fee-reason-required', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/04-pos-delivery-manual-fee-reason-required.png`, fullPage: true });
  });

  test('05-manual-fee-saved', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/05-pos-delivery-manual-fee-saved.png`, fullPage: true });
  });

  test('06-reopened-with-pricing-metadata', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/06-pos-delivery-reopened-with-pricing-metadata.png`, fullPage: true });
  });

  test('07-checkout-with-delivery-fee', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/07-pos-checkout-with-delivery-fee.png`, fullPage: true });
  });

  test('08-cash-delivery-fee-included', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/08-cash-delivery-fee-included.png`, fullPage: true });
  });
});
