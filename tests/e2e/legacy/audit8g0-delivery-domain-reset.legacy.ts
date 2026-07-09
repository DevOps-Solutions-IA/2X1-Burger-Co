import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g0-delivery-domain-reset',
);

const baseUrl = process.env.BASE_URL || 'http://localhost';
const adminCredentials = {
  email: 'admin@2x1burger.co',
  password: 'DevAdmin12345*',
};

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.describe.configure({ retries: 0 });

async function loginAdmin(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByTestId('login-email').fill(adminCredentials.email);
  await page.getByTestId('login-password').fill(adminCredentials.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15000 });
}

test('AUDIT-8G.0 delivery reset keeps manual delivery fee and disables legacy pricing UI', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const auditStamp = Date.now().toString().slice(-7);
  const auditCustomerName = `Cliente Audit 8G0 ${auditStamp}`;
  const auditCustomerPhone = `300${auditStamp}`;

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (/\/api\/|\/pos|\/settings/.test(request.url())) {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
    }
  });

  await loginAdmin(page);

  await page.goto(`${baseUrl}/pos`);
  await expect(page.getByRole('heading', { name: 'POS — 2X1 Burger Co' })).toBeVisible({ timeout: 15000 });
  await page.getByTestId('pos-product-hamb-2x1').click();
  await page.getByLabel('Tipo de atención').selectOption('DELIVERY');
  await page.getByLabel('Cliente').fill(auditCustomerName);
  await page.getByLabel('Teléfono').fill(auditCustomerPhone);
  await page.getByTestId('pos-delivery-reference').fill('Dirección desconocida audit 8G0');

  await expect(page.getByTestId('delivery-manual-quote-panel')).toContainText('Cotización manual requerida');
  await expect(page.getByTestId('delivery-manual-quote-panel')).toContainText('Motor de domicilios en preparación');
  await expect(page.getByTestId('delivery-manual-quote-panel')).toContainText('COP 0');
  await page.screenshot({
    path: path.join(screenshotRoot, '01-pos-delivery-unknown-address-manual-required.png'),
    fullPage: true,
  });

  await page.getByTestId('pos-delivery-manual-fee').fill('7000');
  await expect(page.getByTestId('delivery-manual-quote-panel')).toContainText('COP 7.000');
  await page.screenshot({
    path: path.join(screenshotRoot, '02-pos-delivery-manual-fee-entered.png'),
    fullPage: true,
  });

  const createOrderResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/orders') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  );
  await page.getByRole('button', { name: /Abrir pedido|Guardar/ }).click();
  await createOrderResponse;
  await page.screenshot({
    path: path.join(screenshotRoot, '03-pos-delivery-saved-with-manual-fee.png'),
    fullPage: true,
  });

  await expect(page.getByText(auditCustomerName).first()).toBeVisible({ timeout: 15000 });
  await page.getByText(auditCustomerName).first().click();
  await expect(page.getByTestId('pos-delivery-manual-fee')).toHaveValue('7000');
  await expect(page.getByTestId('delivery-manual-quote-panel')).toContainText('COP 7.000');
  await page.screenshot({
    path: path.join(screenshotRoot, '04-pos-delivery-retained-after-reopen.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByTestId('settings-delivery-reset-panel')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('settings-delivery-reset-panel')).toContainText('Motor de domicilios en preparación');
  await expect(page.getByText('Costo por kilómetro')).toHaveCount(0);
  await expect(page.getByText('Tarifa base (COP)')).toHaveCount(0);
  await page.screenshot({
    path: path.join(screenshotRoot, '05-settings-delivery-legacy-cleaned-or-disabled.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Punto de venta' }).click();
  await expect(page.getByRole('heading', { name: 'POS — 2X1 Burger Co' })).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: path.join(screenshotRoot, '06-pos-mobile-390x844.png'),
    fullPage: true,
  });

  const allowedConsoleNoise = [
    '401 (Unauthorized)',
    '409 (Conflict)',
    '503 (Service Temporarily Unavailable)',
  ];
  expect(consoleErrors.filter((entry) => !allowedConsoleNoise.some((allowed) => entry.includes(allowed)))).toEqual([]);
  expect(failedRequests).toEqual([]);
});
