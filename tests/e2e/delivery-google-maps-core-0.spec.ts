import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/worker-auth';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/delivery-google-maps-core-0',
);

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

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
  await page.getByTestId('pos-delivery-customer-name').fill(`Google Maps ${suffix}`);
  await page.getByTestId('pos-delivery-phone').fill(`318${suffix}`);
}

async function waitForStatus(page: Page, label: string) {
  await expect
    .poll(
      async () => ((await page.getByTestId('pos-delivery-pricing-status').textContent().catch(() => null)) ?? '').trim(),
      { timeout: 15000, intervals: [250, 500, 1000] },
    )
    .toContain(label);
}

function estimateFixture(overrides: Record<string, unknown>) {
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
    distanceKm: 3.08,
    durationMinutes: 9,
    estimatedMinutes: 9,
    weather: { rainIntensity: 'NONE', surcharge: 0, provider: 'openmeteo', unavailable: false },
    schedule: { mode: 'NORMAL', surcharge: 0 },
    logistics: { zoneType: 'MEDIUM', surcharge: 9000 },
    subtotalBenefit: 0,
    manualEdited: false,
    manualEditReason: null,
    breakdown: [{ code: 'AUTO_PRICED', label: 'Tarifa automática', amount: 9000 }],
    warnings: [],
    providerUsage: { geocodingProvider: 'google', routingProvider: 'google', weatherProvider: 'openmeteo' },
    providersUsed: { geocodingProvider: 'google', routingProvider: 'google', weatherProvider: 'openmeteo' },
    weatherImpact: { rainIntensity: 'NONE', surcharge: 0, provider: 'openmeteo', unavailable: false },
    calculationVersion: '2x1-delivery-pricing-v1',
    auditId: 'delivery-google-maps-core-ui-fixture',
    ...overrides,
  };
}

test('DELIVERY-GOOGLE-MAPS-CORE-0 POS Google display-only screenshots', async ({ page, workerAccessToken }) => {
  const productCode = await chooseAvailableProductCode(page, workerAccessToken);
  const suffix = Date.now().toString().slice(-7);

  await page.route('**/api/delivery-location/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          {
            provider: 'google',
            placeId: 'google-place-portal-jamundi',
            label: 'Portal de Jamundí, Jamundí, Valle del Cauca, Colombia',
            mainText: 'Portal de Jamundí',
            secondaryText: 'Jamundí, Valle del Cauca',
            confidence: 'HIGH',
          },
        ],
      }),
    });
  });

  await page.route('**/api/delivery-location/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'google',
        placeId: 'google-place-portal-jamundi',
        formattedAddress: 'Portal de Jamundí, Jamundí, Valle del Cauca, Colombia',
        latitude: 3.2601,
        longitude: -76.5401,
        confidence: 'HIGH',
        warnings: [],
      }),
    });
  });

  await page.route('**/api/delivery-pricing/estimate', async (route) => {
    const body = route.request().postDataJSON() as { addressText?: string; location?: unknown };
    const text = (body.addressText ?? '').toLowerCase();
    if (text.includes('condados')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(estimateFixture({
          status: 'LOCAL_FREE',
          pricingStatus: 'LOCAL_FREE',
          suggestedFee: 0,
          finalFee: 0,
          reasonCode: 'LOCAL_FREE_ZONE',
          humanMessage: 'Domicilio gratis - Condados / Alborada.',
          zoneType: 'LOCAL_FREE',
          zoneLabel: 'Condados / Alborada',
          distanceKm: null,
          durationMinutes: null,
          estimatedMinutes: null,
          providerUsage: { warnings: [] },
          providersUsed: { warnings: [] },
          breakdown: [{ code: 'LOCAL_FREE_ZONE', label: 'Domicilio gratis - Condados / Alborada', amount: 0 }],
        })),
      });
      return;
    }
    if (text.includes('direccion incompleta')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(estimateFixture({
          status: 'NEEDS_ADDRESS_CORRECTION',
          pricingStatus: 'NEEDS_ADDRESS_CORRECTION',
          suggestedFee: null,
          finalFee: null,
          canCheckout: false,
          requiresAddressCorrection: true,
          reasonCode: 'DESTINATION_MISSING',
          humanMessage: 'Selecciona una dirección sugerida o agrega más detalle.',
          confidence: 'LOW',
          zoneType: 'UNKNOWN',
          zoneLabel: null,
          distanceKm: null,
          durationMinutes: null,
          estimatedMinutes: null,
          warnings: ['DESTINATION_MISSING'],
          providerUsage: { warnings: ['DESTINATION_MISSING'] },
          providersUsed: { warnings: ['DESTINATION_MISSING'] },
          breakdown: [{ code: 'DESTINATION_MISSING', label: 'Dirección insuficiente', amount: 0 }],
        })),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(estimateFixture({})),
    });
  });

  await openDeliveryDraft(page, productCode, suffix);
  await page.getByTestId('pos-delivery-reference').fill('portal de jamundi');
  await expect(page.getByTestId('pos-delivery-suggestion').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '01-google-search-suggestions.png'), fullPage: true });

  await page.getByTestId('pos-delivery-suggestion').first().click();
  await expect(page.getByTestId('pos-delivery-place-selected')).toContainText('Portal de Jamundí', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '02-google-place-selected.png'), fullPage: true });

  await page.getByTestId('pos-delivery-recalculate').click();
  await waitForStatus(page, 'CALCULADA');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 9.000');
  await expect(page.getByTestId('pos-delivery-distance')).toContainText('3.1');
  await expect(page.getByTestId('pos-delivery-eta')).toContainText('9');
  await page.screenshot({ path: path.join(screenshotRoot, '03-google-auto-priced.png'), fullPage: true });

  await page.getByTestId('pos-delivery-reference').fill('Condados de la Alborada');
  await page.getByTestId('pos-delivery-neighborhood').fill('Condados / Alborada');
  await page.getByTestId('pos-delivery-recalculate').click();
  await waitForStatus(page, 'GRATIS');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 0');
  await page.screenshot({ path: path.join(screenshotRoot, '04-local-free-no-google-needed.png'), fullPage: true });

  await page.getByTestId('pos-delivery-reference').fill('direccion incompleta');
  await page.getByTestId('pos-delivery-neighborhood').fill('');
  await page.getByTestId('pos-delivery-recalculate').click();
  await waitForStatus(page, 'CORREGIR');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('—');
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Checkout bloqueado');
  await page.screenshot({ path: path.join(screenshotRoot, '05-invalid-address-checkout-blocked.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(screenshotRoot, '06-mobile-clean.png'), fullPage: true });
});
