import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for ephemeral UI tests.`);
  return value;
}

const email = requiredEnv('EPHEMERAL_ADMIN_EMAIL');
const password = requiredEnv('EPHEMERAL_ADMIN_PASSWORD');
const evidenceDir = requiredEnv('EPHEMERAL_EVIDENCE_DIR');
const coreOperationalEnabled = process.env.EPHEMERAL_INCLUDE_CORE_OPERATIONAL === 'true';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('core operational API effects are visible and actionable in the real UI', async ({ page }) => {
  test.skip(!coreOperationalEnabled, 'Core operational fixtures are not enabled for this ephemeral run.');

  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });
  await login(page);

  await page.goto('/cash');
  await expect(page.getByTestId('cash-current-status')).toContainText(/Caja operativa.*Activa/is);
  await expect(page.locator('body')).toContainText(/Historial de caja/i);
  await page.screenshot({ path: path.join(evidenceDir, 'cash-operational-ui.png'), fullPage: true });

  await page.goto('/pos');
  await expect(page.getByTestId('pos-page')).toBeVisible();
  await expect(page.locator('body')).toContainText('Coca-Cola Original 400 ml');
  await page.screenshot({ path: path.join(evidenceDir, 'pos-operational-ui.png'), fullPage: true });

  await page.goto('/deliveries');
  const delivery = page.getByTestId('deliveries-queue-item').filter({ hasText: 'Phase 2.5 Synthetic Delivery' });
  await expect(delivery).toHaveCount(1);
  await delivery.click();
  await expect(page.getByTestId('deliveries-receipt-version')).toContainText(/versión 2/i);
  await expect(page.getByTestId('deliveries-detail')).toContainText(/Ubicación logística recibida/i);
  await expect(page.getByRole('link', { name: 'Abrir mapa' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\//);
  const receiptResponse = page.waitForResponse((response) =>
    response.url().includes('/delivery-receipt') && response.status() === 200,
  );
  await page.getByTestId('deliveries-receipt-view').click();
  await receiptResponse;
  await page.screenshot({ path: path.join(evidenceDir, 'delivery-operational-ui.png'), fullPage: true });

  await page.goto('/inventory');
  await expect(page.locator('body')).toContainText('Pan de hamburguesa');
  await expect(page.locator('body')).toContainText(/PHASE_2_5|Ajuste/i);
  await page.screenshot({ path: path.join(evidenceDir, 'inventory-operational-ui.png'), fullPage: true });

  expect(serverFailures).toEqual([]);
});
