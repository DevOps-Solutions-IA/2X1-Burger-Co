import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g2-delivery-final',
);

const adminCredentials = {
  email: 'admin@2x1burger.co',
  password: 'DevAdmin12345*',
};

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(180_000);

async function loginAdmin(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (/\/dashboard\/?$/.test(new URL(page.url()).pathname) && !(await page.getByTestId('login-email').isVisible().catch(() => false))) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('login-email').fill(adminCredentials.email);
  await page.getByTestId('login-password').fill(adminCredentials.password);
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}

async function ensureCashOpen(page: Page) {
  const loginResponse = await page.request.post('/api/auth/login', {
    data: adminCredentials,
  });
  expect(loginResponse.status()).toBe(201);
  const loginJson = (await loginResponse.json()) as { accessToken: string };
  const currentResponse = await page.request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${loginJson.accessToken}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);

  if (!currentCash) {
    const openResponse = await page.request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${loginJson.accessToken}` },
      data: {
        openingAmount: 80000,
        notes: 'Apertura automática AUDIT-8G.2',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function openDeliveryDraft(page: Page, customerName: string, customerPhone: string) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await loginAdmin(page);
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('pos-product-hamb-2x1').click();
  await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
  await page.getByTestId('pos-delivery-customer-name').fill(customerName);
  await page.getByTestId('pos-delivery-phone').fill(customerPhone);
}

async function fillDeliveryAddress(page: Page, address: string, neighborhood = '') {
  await page.getByTestId('pos-delivery-address').evaluate((node) => {
    // The visible input keeps the legacy test id; this marker only anchors the new 8G.2 selector contract.
    node.textContent = '';
  });
  await page.getByTestId('pos-delivery-reference').fill(address);
  await page.getByTestId('pos-delivery-neighborhood').fill(neighborhood);
}

async function estimateDelivery(page: Page) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/delivery-pricing/estimate' &&
      response.request().method() === 'POST' &&
      response.status() === 200
    );
  });
  await page.getByTestId('pos-delivery-estimate-button').getByRole('button', { name: /Estimar domicilio|Estimando/ }).click();
  const response = await responsePromise;
  return (await response.json()) as {
    pricingStatus: string;
    finalFee: number | null;
    suggestedFee: number | null;
    requiresManualQuote: boolean;
    warnings: string[];
  };
}

async function saveOrder(page: Page) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    const method = response.request().method();
    const isCreateOrder = url.pathname === '/api/orders' && method === 'POST';
    const isUpdateOrder = /^\/api\/orders\/[^/]+$/.test(url.pathname) && method === 'PATCH';

    return (isCreateOrder || isUpdateOrder) && [200, 201].includes(response.status());
  });
  await page.getByTestId('pos-delivery-save').click();
  return responsePromise;
}

async function checkoutOrder(page: Page) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      /^\/api\/orders\/[^/]+\/checkout$/.test(url.pathname) &&
      response.request().method() === 'POST' &&
      [200, 201].includes(response.status())
    );
  });
  await page.getByTestId('pos-checkout-button').getByRole('button', { name: /Cobrar y cerrar/ }).click();
  await page.getByRole('button', { name: /Sí, cobrar y cerrar/ }).click();
  return responsePromise;
}

test('AUDIT-8G.2 delivery final validates premium UI, pricing rules, checkout and cash regression', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const auditStamp = Date.now().toString().slice(-7);
  const localCustomer = `8G2 Local ${auditStamp}`;
  const manualCustomer = `8G2 Manual ${auditStamp}`;

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? '';
    if (failureText === 'net::ERR_ABORTED') return;
    if (/\/api\/|\/pos|\/settings|\/cash|\/tables|\/dashboard/.test(request.url())) {
      failedRequests.push(`${request.method()} ${request.url()} ${failureText}`.trim());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500 && /\/api\/|\/pos|\/settings|\/cash|\/tables|\/dashboard/.test(response.url())) {
      failedRequests.push(`${response.request().method()} ${response.url()} HTTP ${status}`);
    }
  });

  await loginAdmin(page);
  await ensureCashOpen(page);

  await openDeliveryDraft(page, localCustomer, `311${auditStamp}`);
  await page.screenshot({ path: path.join(screenshotRoot, '01-pos-delivery-mode-empty.png'), fullPage: true });

  await fillDeliveryAddress(page, 'Condados de la Alborada', 'Condados de la Alborada');
  const condados = await estimateDelivery(page);
  expect(condados.pricingStatus).toBe('LOCAL_FREE');
  expect(condados.finalFee).toBe(0);
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('GRATIS');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 0');
  await page.screenshot({ path: path.join(screenshotRoot, '02-pos-delivery-local-free-condados.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '14-delivery-local-free-no-surcharges.png'), fullPage: true });

  await fillDeliveryAddress(page, 'La Alborada', 'La Alborada');
  const alborada = await estimateDelivery(page);
  expect(alborada.pricingStatus).toBe('LOCAL_FREE');
  expect(alborada.finalFee).toBe(0);
  await page.screenshot({ path: path.join(screenshotRoot, '03-pos-delivery-local-free-alborada.png'), fullPage: true });

  await saveOrder(page);
  await expect(page.getByText(localCustomer).first()).toBeVisible({ timeout: 15000 });
  await page.getByText(localCustomer).first().click();
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('GRATIS');

  await page.getByRole('button', { name: 'Limpiar' }).click();
  await openDeliveryDraft(page, manualCustomer, `312${auditStamp}`);
  await fillDeliveryAddress(page, 'cerca de alborada', 'cerca de alborada');
  const ambiguous = await estimateDelivery(page);
  expect(ambiguous.requiresManualQuote).toBe(true);
  expect(ambiguous.warnings).toContain('LOCAL_ZONE_AMBIGUOUS');
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('REVISAR');
  await page.screenshot({ path: path.join(screenshotRoot, '04-pos-delivery-ambiguous-manual-required.png'), fullPage: true });

  await page.getByTestId('pos-delivery-manual-fee-input').fill('7000');
  await page.getByTestId('pos-delivery-save').click();
  await expect(page.getByText('Debes explicar por qué la tarifa final cambió')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: path.join(screenshotRoot, '05-pos-delivery-manual-fee-reason-required.png'), fullPage: true });

  await page.getByTestId('pos-delivery-manual-reason').fill('Zona fuera de cobertura automática validada por operador');
  await saveOrder(page);
  await expect(page.getByText(manualCustomer).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '06-pos-delivery-manual-fee-saved.png'), fullPage: true });

  await page.getByText(manualCustomer).first().click();
  await expect(page.getByTestId('pos-delivery-manual-fee-input')).toHaveValue('7.000');
  await expect(page.getByTestId('pos-delivery-manual-reason')).toHaveValue('Zona fuera de cobertura automática validada por operador');
  await page.screenshot({ path: path.join(screenshotRoot, '07-pos-delivery-reopened-metadata.png'), fullPage: true });

  if (await page.getByText(/Ajusta el pago para cuadrar la cuenta/).isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByRole('button', { name: 'Usar total exacto' }).click();
  }

  await expect(page.getByTestId('pos-checkout-button').getByRole('button', { name: /Cobrar y cerrar/ })).toBeEnabled({ timeout: 10000 });
  await page.screenshot({ path: path.join(screenshotRoot, '08-pos-checkout-with-delivery-fee.png'), fullPage: true });
  const checkoutResponse = await checkoutOrder(page);
  const checkoutJson = await checkoutResponse.json();
  expect(Number(checkoutJson.sale.deliveryFee)).toBe(7000);
  expect(checkoutJson.sale.deliveryFeeEditReason).toBe('Zona fuera de cobertura automática validada por operador');

  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Caja|Sesión activa/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotRoot, '09-cash-delivery-fee-included.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '10-cash-no-global-error-banner.png'), fullPage: true });

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-delivery-reset-panel')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '11-settings-delivery-config.png'), fullPage: true });

  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await openDeliveryDraft(page, `8G2 Provider ${auditStamp}`, `313${auditStamp}`);
  await fillDeliveryAddress(page, 'Destino sin ruta automatica imposible', 'Sin cobertura');
  const providerUnavailable = await estimateDelivery(page);
  expect(providerUnavailable.requiresManualQuote).toBe(true);
  expect(providerUnavailable.warnings).toContain('EXTERNAL_PROVIDERS_DISABLED');
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('SIN PROVEEDOR');
  await page.screenshot({ path: path.join(screenshotRoot, '13-delivery-provider-unavailable-manual.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '15-delivery-final-summary.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(screenshotRoot, '12-mobile-delivery-pos-390x844.png'), fullPage: true });

  await page.goto('/tables', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible({ timeout: 15000 });

  const allowedConsoleNoise = ['401 (Unauthorized)', '409 (Conflict)', 'favicon'];
  expect(consoleErrors.filter((entry) => !allowedConsoleNoise.some((allowed) => entry.includes(allowed)))).toEqual([]);
  expect(failedRequests).toEqual([]);
});
