import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/worker-auth';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/runtime-delivery-geo-address-fix-1',
);

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(90_000);

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
  expect(product).toBeTruthy();
  return product!.code.toLowerCase();
}

async function openDeliveryDraft(page: Page, productCode: string, suffix: string) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`pos-product-${productCode}`)).toBeEnabled({ timeout: 15000 });
  await page.getByTestId(`pos-product-${productCode}`).click();
  await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
  await page.getByTestId('pos-delivery-customer-name').fill(`Runtime Geo ${suffix}`);
  await page.getByTestId('pos-delivery-phone').fill(`318${suffix}`);
}

async function fillDeliveryAddress(page: Page, address: string, neighborhood: string) {
  await page.getByTestId('pos-delivery-reference').fill(address);
  await page.getByTestId('pos-delivery-neighborhood').fill(neighborhood);
}

async function waitForStatus(page: Page, label: string) {
  const status = page.getByTestId('pos-delivery-pricing-status');
  const recalculate = page.getByTestId('pos-delivery-recalculate');
  let clicked = false;
  await expect
    .poll(
      async () => {
        const value = (await status.textContent().catch(() => null)) ?? '';
        if (value.includes(label)) return label;
        if (!clicked && (await recalculate.isEnabled().catch(() => false))) {
          clicked = true;
          await recalculate.click();
        }
        return value;
      },
      { timeout: 15000, intervals: [250, 500, 1000] },
    )
    .toBe(label);
}

function estimateResponse(overrides: Record<string, unknown>) {
  return {
    status: 'AUTO_PRICED',
    pricingStatus: 'AUTO_PRICED',
    suggestedFee: 9000,
    finalFee: 9000,
    currency: 'COP',
    canCheckout: true,
    requiresAddressCorrection: false,
    reasonCode: 'AUTO_PRICED',
    humanMessage: 'Tarifa de domicilio calculada automáticamente.',
    requiresManualQuote: false,
    confidence: 'HIGH',
    zoneType: 'MEDIUM',
    zoneLabel: 'Jamundí',
    localZoneMatch: null,
    zoneMatch: null,
    distanceKm: 3.1,
    durationMinutes: 7,
    estimatedMinutes: 7,
    weather: { rainIntensity: 'NONE', surcharge: 0, provider: 'openmeteo', unavailable: false },
    schedule: { mode: 'NORMAL', surcharge: 0 },
    logistics: { zoneType: 'MEDIUM', surcharge: 9000 },
    subtotalBenefit: 0,
    manualEdited: false,
    manualEditReason: null,
    breakdown: [{ code: 'AUTO_PRICED', label: 'Tarifa automática', amount: 9000 }],
    warnings: [],
    providerUsage: { geocodingProvider: 'openrouteservice', routingProvider: 'openrouteservice', weatherProvider: 'openmeteo' },
    providersUsed: { geocodingProvider: 'openrouteservice', routingProvider: 'openrouteservice', weatherProvider: 'openmeteo' },
    weatherImpact: { rainIntensity: 'NONE', surcharge: 0, provider: 'openmeteo', unavailable: false },
    calculationVersion: '2x1-delivery-pricing-v1',
    auditId: 'runtime-ui-fixture',
    ...overrides,
  };
}

test('RUNTIME-DELIVERY-GEO-ADDRESS-FIX-1 POS clean copy and fee display', async ({ page, workerAccessToken }) => {
  const productCode = await chooseAvailableProductCode(page, workerAccessToken);
  const suffix = Date.now().toString().slice(-7);

  await page.route('**/api/delivery-pricing/estimate', async (route) => {
    const body = route.request().postDataJSON() as { addressText?: string };
    const address = (body.addressText ?? '').toLowerCase();
    if (address.includes('calle 11')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(estimateResponse({
          status: 'NEEDS_ADDRESS_CORRECTION',
          pricingStatus: 'NEEDS_ADDRESS_CORRECTION',
          suggestedFee: null,
          finalFee: null,
          canCheckout: false,
          requiresAddressCorrection: true,
          reasonCode: 'DESTINATION_MISSING',
          humanMessage: 'La dirección no tiene coordenadas confiables. Corrige la dirección para calcular el domicilio.',
          confidence: 'LOW',
          zoneType: 'UNKNOWN',
          zoneLabel: null,
          distanceKm: null,
          durationMinutes: null,
          estimatedMinutes: null,
          warnings: ['DESTINATION_MISSING'],
          breakdown: [{ code: 'DESTINATION_MISSING', label: 'Dirección insuficiente', amount: 0 }],
        })),
      });
      return;
    }

    if (address.includes('condados')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(estimateResponse({
          status: 'LOCAL_FREE',
          pricingStatus: 'LOCAL_FREE',
          suggestedFee: 0,
          finalFee: 0,
          canCheckout: true,
          reasonCode: 'LOCAL_FREE_ZONE',
          humanMessage: 'Domicilio gratis - Condados / Alborada.',
          zoneType: 'LOCAL_FREE',
          zoneLabel: 'Condados / Alborada',
          distanceKm: null,
          durationMinutes: null,
          estimatedMinutes: null,
          breakdown: [{ code: 'LOCAL_FREE_ZONE', label: 'Zona local gratis', amount: 0 }],
        })),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(estimateResponse({})),
    });
  });

  await openDeliveryDraft(page, productCode, suffix);
  await fillDeliveryAddress(page, 'calle 11 2as # 167', 'portal de jamundi');
  await waitForStatus(page, 'CORREGIR');
  await expect(page.getByTestId('pos-delivery-pricing-status')).not.toContainText('DESTINATION_MISSING');
  await expect(page.getByTestId('pos-delivery-warning')).not.toContainText('DESTINATION_MISSING');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('—');
  await expect(page.getByTestId('pos-delivery-warning')).toContainText('No se pudo ubicar la dirección. Agrega más detalle.');
  await expect(page.getByLabel('Notifications alt+T').getByText('No se pudo ubicar la dirección')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: path.join(screenshotRoot, '01-destination-missing-no-raw-code-no-cop0.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '04-toast-clean-address-detail.png'), fullPage: true });

  await fillDeliveryAddress(page, 'Portal de Jamundí, Jamundí, Valle del Cauca, Colombia', 'Jamundí');
  await waitForStatus(page, 'CALCULADA');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 9.000');
  await expect(page.getByTestId('pos-delivery-distance')).toContainText('3.1');
  await expect(page.getByTestId('pos-delivery-eta')).toContainText('7');
  await page.screenshot({ path: path.join(screenshotRoot, '02-poi-auto-priced-distance-time.png'), fullPage: true });

  await fillDeliveryAddress(page, 'Condados de la Alborada', 'Condados / Alborada');
  await waitForStatus(page, 'GRATIS');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 0');
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Habilitado');
  await page.screenshot({ path: path.join(screenshotRoot, '03-local-free-cop0-valid.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await fillDeliveryAddress(page, 'calle 11 2as # 167', 'portal de jamundi');
  await waitForStatus(page, 'CORREGIR');
  await page.screenshot({ path: path.join(screenshotRoot, '05-mobile-clean.png'), fullPage: true });
});
