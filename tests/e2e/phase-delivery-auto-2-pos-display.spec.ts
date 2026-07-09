import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/worker-auth';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/phase-delivery-auto-2',
);

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

async function ensureCashOpen(page: Page, accessToken: string) {
  const currentResponse = await page.request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);

  if (!currentCash) {
    const openResponse = await page.request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        openingAmount: 80000,
        notes: 'Apertura automática PHASE-DELIVERY-AUTO-2',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

type SellableProduct = {
  code: string;
  kind: string;
  currentStock: string | number;
};

async function chooseAvailableProductCode(page: Page, accessToken: string) {
  const response = await page.request.get('/api/products/sellable', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  const products = (await response.json()) as SellableProduct[];
  const product = products.find(
    (item) => item.kind === 'DIRECT_STOCK' && Number(item.currentStock) > 5 && item.code.trim().length > 0,
  );
  expect(product, 'No hay producto de stock directo suficiente para ejecutar E2E sin agotar inventario.').toBeTruthy();
  return product!.code.toLowerCase();
}

async function openDeliveryDraft(page: Page, productCode: string, customerName: string, customerPhone: string) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`pos-product-${productCode}`)).toBeEnabled({ timeout: 15000 });
  await page.getByTestId(`pos-product-${productCode}`).click();
  await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
  await page.getByTestId('pos-delivery-customer-name').fill(customerName);
  await page.getByTestId('pos-delivery-phone').fill(customerPhone);
}

async function fillDeliveryAddress(page: Page, address: string, neighborhood = '') {
  await page.getByTestId('pos-delivery-reference').fill(address);
  await page.getByTestId('pos-delivery-neighborhood').fill(neighborhood);
}

async function waitForEstimate(page: Page, expectedStatus: string) {
  const expectedLabel = deliveryStatusLabel(expectedStatus);
  const status = page.getByTestId('pos-delivery-pricing-status');
  const recalculate = page.getByTestId('pos-delivery-recalculate');
  let clickedRecalculate = false;
  await expect
    .poll(
      async () => {
        const statusText = (await status.textContent().catch(() => null)) ?? '';
        if (statusText.includes(expectedLabel)) {
          return expectedLabel;
        }
        if (!clickedRecalculate && (await recalculate.isEnabled().catch(() => false))) {
          clickedRecalculate = true;
          await recalculate.click();
        }
        return statusText;
      },
      { timeout: 15000, intervals: [250, 500, 1000] },
    )
    .toBe(expectedLabel);
}

function deliveryStatusLabel(status: string) {
  const labels: Record<string, string> = {
    LOCAL_FREE: 'GRATIS',
    AUTO_PRICED: 'CALCULADA',
    NEEDS_ADDRESS_CORRECTION: 'CORREGIR',
    PROVIDER_UNAVAILABLE: 'NO DISPONIBLE',
    OUT_OF_COVERAGE: 'SIN COBERTURA',
    ERROR_RETRYABLE: 'REINTENTAR',
  };
  return labels[status] ?? status;
}

function deliveryEstimateFixture(overrides: Record<string, unknown>) {
  return {
    status: 'PROVIDER_UNAVAILABLE',
    pricingStatus: 'PROVIDER_UNAVAILABLE',
    suggestedFee: null,
    finalFee: null,
    currency: 'COP',
    canCheckout: false,
    requiresAddressCorrection: false,
    reasonCode: 'PROVIDER_UNAVAILABLE',
    humanMessage: 'No se pudo calcular en este momento. Intenta de nuevo.',
    requiresManualQuote: false,
    confidence: 'LOW',
    zoneType: 'UNKNOWN',
    zoneLabel: null,
    localZoneMatch: null,
    zoneMatch: null,
    distanceKm: null,
    durationMinutes: null,
    estimatedMinutes: null,
    weather: { rainIntensity: 'UNKNOWN', surcharge: 0, provider: null, unavailable: true },
    schedule: { mode: 'NORMAL', surcharge: 0 },
    logistics: { zoneType: 'UNKNOWN', surcharge: 0 },
    subtotalBenefit: 0,
    manualEdited: false,
    manualEditReason: null,
    breakdown: [{ code: 'PROVIDER_UNAVAILABLE', label: 'Proveedor no disponible', amount: 0 }],
    warnings: ['PROVIDER_UNAVAILABLE'],
    providerUsage: { warnings: ['PROVIDER_UNAVAILABLE'] },
    providersUsed: { warnings: ['PROVIDER_UNAVAILABLE'] },
    weatherImpact: { rainIntensity: 'UNKNOWN', surcharge: 0, provider: null, unavailable: true },
    calculationVersion: '2x1-delivery-pricing-v1',
    auditId: 'phase-auto-2-provider-fixture',
    ...overrides,
  };
}

async function recalculateIfAvailable(page: Page) {
  const recalculate = page.getByTestId('pos-delivery-recalculate');
  if (await recalculate.isEnabled().catch(() => false)) {
    await recalculate.click();
  }
}

test('PHASE-DELIVERY-AUTO-2 POS display-only delivery pricing flow', async ({
  page,
  workerAccessToken,
}) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const auditStamp = Date.now().toString().slice(-7);
  let estimateCalls = 0;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/delivery-pricing/estimate' && request.method() === 'POST') {
      estimateCalls += 1;
    }
  });
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? '';
    if (failureText === 'net::ERR_ABORTED') return;
    if (/\/api\/|\/pos|\/cash|\/dashboard/.test(request.url())) {
      failedRequests.push(`${request.method()} ${request.url()} ${failureText}`.trim());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500 && /\/api\/|\/pos|\/cash|\/dashboard/.test(response.url())) {
      failedRequests.push(`${response.request().method()} ${response.url()} HTTP ${status}`);
    }
  });
  let delayedFirstEstimate = false;
  await page.route('**/api/delivery-pricing/estimate', async (route) => {
    let body: { addressText?: string } | null = null;
    try {
      body = route.request().postDataJSON() as { addressText?: string };
    } catch {
      body = null;
    }
    if ((body?.addressText ?? '').toLowerCase().includes('carrera 99 destino de prueba')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(deliveryEstimateFixture({})),
      });
      return;
    }
    if (!delayedFirstEstimate) {
      delayedFirstEstimate = true;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });

  await ensureCashOpen(page, workerAccessToken);
  const productCode = await chooseAvailableProductCode(page, workerAccessToken);

  await openDeliveryDraft(page, productCode, `AUTO2 Pendiente ${auditStamp}`, `315${auditStamp}`);
  await page.screenshot({ path: path.join(screenshotRoot, '01-pending-address.png'), fullPage: true });

  await fillDeliveryAddress(page, 'Condados de la Alborada', 'Condados de la Alborada');
  await expect(page.getByTestId('pos-delivery-calculating')).toContainText('Calculando', { timeout: 3000 });
  await page.screenshot({ path: path.join(screenshotRoot, '02-calculating.png'), fullPage: true });
  await waitForEstimate(page, 'GRATIS');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 0');
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Habilitado');
  await expect(page.getByTestId('pos-delivery-manual-fee-input')).toHaveCount(0);
  await expect(page.getByTestId('pos-delivery-manual-reason')).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotRoot, '03-local-free.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '08-checkout-allowed-local-free.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '09-no-manual-fee-ui.png'), fullPage: true });

  await expect(page.getByTestId('pos-delivery-save')).toBeEnabled();
  await page.getByTestId('pos-delivery-save').click();
  await expect(page.getByText(`AUTO2 Pendiente ${auditStamp}`).first()).toBeVisible({ timeout: 15000 });

  await openDeliveryDraft(page, productCode, `AUTO2 Ambigua ${auditStamp}`, `316${auditStamp}`);
  await fillDeliveryAddress(page, 'cerca de alborada', 'cerca de alborada');
  await waitForEstimate(page, 'NEEDS_ADDRESS_CORRECTION');
  await expect(page.getByTestId('pos-delivery-message')).toContainText(/corrige|Corrige/);
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Checkout bloqueado');
  await expect(page.getByTestId('pos-delivery-save')).toBeDisabled();
  await page.screenshot({ path: path.join(screenshotRoot, '05-address-correction-required.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '07-checkout-blocked.png'), fullPage: true });

  await page.getByRole('button', { name: 'Limpiar' }).click();
  await openDeliveryDraft(page, productCode, `AUTO2 Provider ${auditStamp}`, `317${auditStamp}`);
  await fillDeliveryAddress(page, 'Carrera 99 destino de prueba', 'Jamundí centro');
  await waitForEstimate(page, 'PROVIDER_UNAVAILABLE');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('—');
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Checkout bloqueado');
  await page.screenshot({ path: path.join(screenshotRoot, '04-auto-priced-or-provider-disabled.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '06-provider-unavailable.png'), fullPage: true });

  const callsBeforeTyping = estimateCalls;
  await page.getByTestId('pos-delivery-reference').fill('');
  await page.getByTestId('pos-delivery-reference').pressSequentially('Condados de la Alborada', { delay: 20 });
  await waitForEstimate(page, 'GRATIS');
  const callsAfterTyping = estimateCalls - callsBeforeTyping;
  expect(callsAfterTyping).toBeLessThanOrEqual(2);

  await openDeliveryDraft(page, productCode, `AUTO2 Recalculo ${auditStamp}`, `318${auditStamp}`);
  await page.getByTestId('pos-delivery-reference').fill('cerca de alborada');
  if (await page.getByTestId('pos-delivery-recalculate').isEnabled().catch(() => false)) {
    await page.getByTestId('pos-delivery-recalculate').click();
  }
  await waitForEstimate(page, 'NEEDS_ADDRESS_CORRECTION');
  await fillDeliveryAddress(page, 'Condados de la Alborada', 'Condados de la Alborada');
  await recalculateIfAvailable(page);
  await waitForEstimate(page, 'GRATIS');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(screenshotRoot, '10-mobile-390x844.png'), fullPage: true });

  const allowedConsoleNoise = ['401 (Unauthorized)', '409 (Conflict)', 'favicon'];
  expect(consoleErrors.filter((entry) => !allowedConsoleNoise.some((allowed) => entry.includes(allowed)))).toEqual([]);
  expect(failedRequests).toEqual([]);
});
