import { test } from '@playwright/test';
const D = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/ref-delivery-ui-0';

test.describe('Delivery UI Screenshots', () => {
  test.setTimeout(30000);
  test('01-delivery-panel-empty-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/01-delivery-panel-empty-enterprise.png`, fullPage: true });
  });
  test('02-delivery-local-free-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/02-delivery-local-free-enterprise.png`, fullPage: true });
  });
  test('03-delivery-auto-priced-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/03-delivery-auto-priced-enterprise.png`, fullPage: true });
  });
  test('04-delivery-manual-quote-required-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/04-delivery-manual-quote-required-enterprise.png`, fullPage: true });
  });
  test('05-delivery-manual-fee-validation-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/05-delivery-manual-fee-validation-enterprise.png`, fullPage: true });
  });
  test('06-delivery-manual-fee-saved-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/06-delivery-manual-fee-saved-enterprise.png`, fullPage: true });
  });
  test('07-delivery-provider-unavailable-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/07-delivery-provider-unavailable-enterprise.png`, fullPage: true });
  });
  test('08-delivery-final-summary-enterprise', async ({ page }) => {
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/08-delivery-final-summary-enterprise.png`, fullPage: true });
  });
  test('09-delivery-mobile-390x844-enterprise', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/09-delivery-mobile-390x844-enterprise.png`, fullPage: true });
  });
  test('10-delivery-pos-full-context-enterprise', async ({ page }) => {
    await page.goto('http://localhost/pos', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${D}/10-delivery-pos-full-context-enterprise.png`, fullPage: true });
  });
});
