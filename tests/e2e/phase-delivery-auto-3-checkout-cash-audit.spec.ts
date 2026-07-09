import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/worker-auth';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/phase-delivery-auto-3',
);

const adminCredentials = {
  email: 'admin@2x1burger.co',
  password: 'DevAdmin12345*',
};

const prisma = new PrismaClient();

type AuthContext = {
  token: string;
  productId: string;
  productCode: string;
  productSalePrice: number;
  cashPaymentMethodId: string;
};

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });
test.setTimeout(180_000);

async function fillLoginForm(page: Page) {
  await page.waitForLoadState('load');
  await page.getByTestId('login-email').click();
  await page.getByTestId('login-email').pressSequentially(adminCredentials.email);
  await page.getByTestId('login-password').click();
  await page.getByTestId('login-password').pressSequentially(adminCredentials.password);
  await expect(page.getByTestId('login-email')).toHaveValue(adminCredentials.email);
  await expect(page.getByTestId('login-password')).toHaveValue(adminCredentials.password);
}

async function ensureCashOpen(request: APIRequestContext, token: string) {
  const currentResponse = await request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);

  if (!currentCash) {
    const openResponse = await request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        openingAmount: 90000,
        notes: 'Apertura automática PHASE-DELIVERY-AUTO-3',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function getAuthContext(request: APIRequestContext, token: string): Promise<AuthContext> {
  await ensureCashOpen(request, token);

  const [product, cashPaymentMethod] = await Promise.all([
    prisma.product.findFirstOrThrow({
      where: {
        isActive: true,
        kind: 'DIRECT_STOCK',
        currentStock: { gt: 5 },
      },
      orderBy: { currentStock: 'desc' },
    }),
    prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
  ]);

  return {
    token,
    productId: product.id,
    productCode: product.code.toLowerCase(),
    productSalePrice: Number(product.salePrice),
    cashPaymentMethodId: cashPaymentMethod.id,
  };
}

async function openDeliveryDraft(page: Page, productCode: string, customerName: string, customerPhone: string) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await fillLoginForm(page);
    await Promise.all([
      page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
      page.getByTestId('login-submit').click(),
    ]);
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  }
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

async function createDeliveryOrder(
  request: APIRequestContext,
  auth: AuthContext,
  payload: {
    customerName: string;
    customerPhone: string;
    deliveryReference: string;
  },
) {
  const response = await request.post('/api/orders', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      type: 'DELIVERY',
      ...payload,
      items: [{ productId: auth.productId, quantity: 1 }],
    },
  });

  expect(response.status()).toBe(201);
  return (await response.json()) as {
    id: string;
    number: string;
    subtotal: string;
    deliveryFee: string;
    deliveryPricingStatus: string;
  };
}

async function checkoutOrder(
  request: APIRequestContext,
  auth: AuthContext,
  orderId: string,
  amount: number,
) {
  return request.post(`/api/orders/${orderId}/checkout`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      payments: [{ paymentMethodId: auth.cashPaymentMethodId, amount }],
    },
  });
}

async function openOrderInPos(page: Page, orderNumber: string) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await fillLoginForm(page);
    await Promise.all([
      page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
      page.getByTestId('login-submit').click(),
    ]);
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`order-card-${orderNumber.toLowerCase()}`)).toBeVisible({ timeout: 15000 });
  await page.getByTestId(`order-card-${orderNumber.toLowerCase()}`).click();
}

async function confirmCheckoutFromPos(page: Page) {
  const checkoutResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && /\/api\/orders\/[^/]+\/checkout$/.test(url.pathname);
  });

  await page.getByTestId('pos-checkout-order').click();
  await page.getByRole('button', { name: 'Sí, cobrar y cerrar' }).click();

  const checkoutResponse = await checkoutResponsePromise;
  const checkoutBody = await checkoutResponse.text();
  expect(checkoutResponse.status(), checkoutBody).toBe(201);
  const parsedCheckout = JSON.parse(checkoutBody) as {
    order: { id: string; deliveryPricingStatus: string; deliveryCalculationVersion: string | null };
    sale: {
      id: string;
      number: string;
      deliveryFee: string;
      deliveryPricingBreakdown?: unknown;
      deliveryCalculationVersion?: string | null;
    };
  };
  return parsedCheckout;
}

test('PHASE-DELIVERY-AUTO-3 checkout, cash, audit and anti-injection gate', async ({ page, request, workerAccessToken }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const auth = await getAuthContext(request, workerAccessToken);
  const auditStamp = Date.now().toString().slice(-7);

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (requestInfo) => {
    const failureText = requestInfo.failure()?.errorText ?? '';
    if (failureText === 'net::ERR_ABORTED') return;
    if (/\/api\/|\/pos|\/cash/.test(requestInfo.url())) {
      failedRequests.push(`${requestInfo.method()} ${requestInfo.url()} ${failureText}`.trim());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500 && /\/api\/|\/pos|\/cash/.test(response.url())) {
      failedRequests.push(`${response.request().method()} ${response.url()} HTTP ${status}`);
    }
  });

  await openDeliveryDraft(page, auth.productCode, `AUTO3 Local ${auditStamp}`, `318${auditStamp}`);
  await fillDeliveryAddress(page, 'Condados de la Alborada', 'Condados de la Alborada');
  await waitForEstimate(page, 'GRATIS');
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 0');
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Habilitado');
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname === '/api/orders';
    }),
    page.getByTestId('pos-delivery-save').click(),
  ]);

  const localOrder = await prisma.orderTicket.findFirstOrThrow({
    where: { customerName: `AUTO3 Local ${auditStamp}` },
    orderBy: { createdAt: 'desc' },
  });

  await openOrderInPos(page, localOrder.number);
  await page.screenshot({ path: path.join(screenshotRoot, '01-local-free-checkout.png'), fullPage: true });
  const localCheckout = await confirmCheckoutFromPos(page);
  expect(localCheckout.order.deliveryPricingStatus).toBe('LOCAL_FREE');
  expect(Number(localCheckout.sale.deliveryFee)).toBe(0);
  expect(localCheckout.sale.deliveryCalculationVersion).toBeTruthy();

  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId(`cash-sale-delivery-fee-${localCheckout.sale.id}`)).toContainText('COP 0', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '02-local-free-cash.png'), fullPage: true });

  const autoOrder = await createDeliveryOrder(request, auth, {
    customerName: `AUTO3 Ruta ${auditStamp}`,
    customerPhone: `319${auditStamp}`,
    deliveryReference: 'Condados de la Alborada',
  });
  await prisma.orderTicket.update({
    where: { id: autoOrder.id },
    data: {
      subtotal: 28500,
      deliveryFee: 8500,
      deliveryFeeSuggested: 8500,
      deliveryFeeEdited: false,
      deliveryFeeEditReason: null,
      deliveryDistanceKm: 3.25,
      deliveryZoneLabel: 'Ruta fixture backend',
      deliveryPricingStatus: 'AUTO_PRICED',
      deliveryPricingConfidence: 'HIGH',
      deliveryPricingBreakdown: [
        { code: 'BASE_FARE', label: 'Tarifa base', amount: 5000 },
        { code: 'DISTANCE_EXTRA', label: 'Distancia adicional', amount: 2500 },
        { code: 'TIME_BLOCKS', label: 'Tiempo estimado', amount: 1000 },
      ],
      deliveryCalculationVersion: 'phase-delivery-auto-3-fixture',
      deliveryRequiresManualQuote: false,
      deliveryRouteProvider: 'fixture',
      deliveryWeatherProvider: 'fixture',
      deliveryGeocodingProvider: 'fixture',
      deliveryEstimatedMinutes: 24,
    },
  });

  await page.route('**/api/delivery-pricing/estimate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pricingStatus: 'AUTO_PRICED',
        status: 'AUTO_PRICED',
        suggestedFee: 8500,
        finalFee: 8500,
        currency: 'COP',
        confidence: 'HIGH',
        calculationVersion: 'phase-delivery-auto-3-fixture',
        canCheckout: true,
        requiresAddressCorrection: false,
        reasonCode: 'AUTO_PRICED',
        humanMessage: 'Tarifa automática fixture validada por backend.',
        breakdown: [
          { code: 'BASE_FARE', label: 'Tarifa base', amount: 5000 },
          { code: 'DISTANCE_EXTRA', label: 'Distancia adicional', amount: 2500 },
          { code: 'TIME_BLOCKS', label: 'Tiempo estimado', amount: 1000 },
        ],
        providersUsed: { routing: 'fixture', geocoding: 'fixture', weather: 'fixture' },
        providerUsage: { routingProvider: 'fixture', geocodingProvider: 'fixture', weatherProvider: 'fixture' },
        distanceKm: 3.25,
        estimatedMinutes: 24,
        durationMinutes: 24,
        weatherImpact: { rainIntensity: 'NONE', surcharge: 0 },
        weather: { rainIntensity: 'NONE', surcharge: 0, unavailable: false },
        schedule: { mode: 'NORMAL', surcharge: 0 },
        subtotalBenefit: 0,
        zoneMatch: { matched: false, zoneLabel: 'Ruta fixture backend' },
        zoneType: 'MEDIUM',
        zoneLabel: 'Ruta fixture backend',
        requiresManualQuote: false,
        manualEdited: false,
        manualEditReason: null,
        warnings: [],
      }),
    });
  });

  await openOrderInPos(page, autoOrder.number);
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('CALCULADA', { timeout: 15000 });
  await expect(page.getByTestId('pos-delivery-final-fee')).toContainText('COP 8.500');
  await page.screenshot({ path: path.join(screenshotRoot, '03-auto-priced-checkout.png'), fullPage: true });
  await page.unroute('**/api/delivery-pricing/estimate');

  const autoCheckoutResponse = await checkoutOrder(request, auth, autoOrder.id, auth.productSalePrice + 8500);
  const autoCheckoutBody = await autoCheckoutResponse.text();
  expect(autoCheckoutResponse.status(), autoCheckoutBody).toBe(201);
  const autoCheckout = JSON.parse(autoCheckoutBody) as {
    sale: {
      id: string;
      deliveryFee: string;
      deliveryPricingBreakdown?: unknown;
      deliveryCalculationVersion?: string | null;
    };
  };
  expect(Number(autoCheckout.sale.deliveryFee)).toBe(8500);
  expect(autoCheckout.sale.deliveryCalculationVersion).toBe('phase-delivery-auto-3-fixture');
  expect(autoCheckout.sale.deliveryPricingBreakdown).toBeTruthy();

  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId(`cash-sale-delivery-fee-${autoCheckout.sale.id}`)).toContainText('COP 8.500', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '04-auto-priced-cash.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '08-cash-no-banner.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotRoot, '09-sale-delivery-metadata.png'), fullPage: true });

  await openDeliveryDraft(page, auth.productCode, `AUTO3 Ambigua ${auditStamp}`, `320${auditStamp}`);
  await fillDeliveryAddress(page, 'cerca de alborada', 'cerca de alborada');
  await waitForEstimate(page, 'NEEDS_ADDRESS_CORRECTION');
  await expect(page.getByTestId('pos-delivery-save')).toBeDisabled();
  await page.screenshot({ path: path.join(screenshotRoot, '05-address-correction-blocked.png'), fullPage: true });

  const ambiguousOrder = await createDeliveryOrder(request, auth, {
    customerName: `AUTO3 API Ambigua ${auditStamp}`,
    customerPhone: `321${auditStamp}`,
    deliveryReference: 'cerca de alborada',
  });
  expect(ambiguousOrder.deliveryPricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
  const ambiguousCheckout = await checkoutOrder(request, auth, ambiguousOrder.id, 20000);
  expect(ambiguousCheckout.status()).toBe(400);
  const ambiguousSale = await prisma.sale.findUnique({ where: { orderTicketId: ambiguousOrder.id } });
  expect(ambiguousSale).toBeNull();

  await page.getByRole('button', { name: 'Limpiar' }).click();
  await page.route('**/api/delivery-pricing/estimate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pricingStatus: 'PROVIDER_UNAVAILABLE',
        status: 'PROVIDER_UNAVAILABLE',
        suggestedFee: null,
        finalFee: null,
        currency: 'COP',
        confidence: 'LOW',
        calculationVersion: '2x1-delivery-pricing-v1',
        canCheckout: false,
        requiresAddressCorrection: false,
        reasonCode: 'PROVIDER_UNAVAILABLE',
        humanMessage: 'No se pudo calcular en este momento. Intenta de nuevo.',
        breakdown: [{ code: 'PROVIDER_UNAVAILABLE', label: 'Proveedor no disponible', amount: 0 }],
        providersUsed: { warnings: ['PROVIDER_UNAVAILABLE'] },
        providerUsage: { warnings: ['PROVIDER_UNAVAILABLE'] },
        distanceKm: null,
        estimatedMinutes: null,
        durationMinutes: null,
        weatherImpact: { rainIntensity: 'UNKNOWN', surcharge: 0, unavailable: true },
        weather: { rainIntensity: 'UNKNOWN', surcharge: 0, unavailable: true },
        schedule: { mode: 'NORMAL', surcharge: 0 },
        subtotalBenefit: 0,
        zoneMatch: null,
        zoneType: 'UNKNOWN',
        zoneLabel: null,
        requiresManualQuote: false,
        manualEdited: false,
        manualEditReason: null,
        warnings: ['PROVIDER_UNAVAILABLE'],
      }),
    });
  });
  await openDeliveryDraft(page, auth.productCode, `AUTO3 Provider ${auditStamp}`, `322${auditStamp}`);
  await fillDeliveryAddress(page, 'Carrera 99 destino de prueba', 'Jamundí centro');
  await waitForEstimate(page, 'PROVIDER_UNAVAILABLE');
  await expect(page.getByTestId('pos-delivery-save')).toBeDisabled();
  await page.screenshot({ path: path.join(screenshotRoot, '06-provider-unavailable-blocked.png'), fullPage: true });
  await page.unroute('**/api/delivery-pricing/estimate');

  const unavailableOrder = await createDeliveryOrder(request, auth, {
    customerName: `AUTO3 Provider API ${auditStamp}`,
    customerPhone: `323${auditStamp}`,
    deliveryReference: 'Carrera 99 destino de prueba',
  });
  await prisma.orderTicket.update({
    where: { id: unavailableOrder.id },
    data: {
      deliveryFee: 0,
      deliveryFeeSuggested: null,
      deliveryPricingStatus: 'PROVIDER_UNAVAILABLE',
      deliveryPricingConfidence: 'LOW',
      deliveryPricingBreakdown: [{ code: 'PROVIDER_UNAVAILABLE', label: 'Proveedor no disponible', amount: 0 }],
      deliveryCalculationVersion: 'phase-delivery-auto-3-provider-fixture',
      deliveryRequiresManualQuote: true,
      deliveryDistanceKm: null,
      deliveryEstimatedMinutes: null,
    },
  });
  const unavailableCheckout = await checkoutOrder(request, auth, unavailableOrder.id, 27000);
  expect(unavailableCheckout.status()).toBe(400);

  const injectedSaleResponse = await request.post('/api/sales', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      channel: 'DOMICILIO',
      deliveryReference: 'Intento fee falso',
      deliveryFee: 7000,
      deliveryFeeEditReason: 'No debe ser operativo',
      items: [{ productId: auth.productId, quantity: 1 }],
      payments: [{ paymentMethodId: auth.cashPaymentMethodId, amount: auth.productSalePrice + 7000 }],
    },
  });
  expect(injectedSaleResponse.status()).toBe(400);
  const injectedSale = await prisma.sale.findFirst({
    where: {
      channel: 'DOMICILIO',
      deliveryReference: 'Intento fee falso',
    },
  });
  expect(injectedSale).toBeNull();
  await page.screenshot({ path: path.join(screenshotRoot, '07-anti-injection-rejected.png'), fullPage: true });

  const currentCash = await request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(currentCash.ok()).toBeTruthy();
  const sales = await request.get('/api/sales', {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(sales.ok()).toBeTruthy();
  const salesJson = (await sales.json()) as Array<{ id: string; deliveryFee: string; total: string }>;
  expect(Number(salesJson.find((sale) => sale.id === localCheckout.sale.id)?.deliveryFee)).toBe(0);
  expect(Number(salesJson.find((sale) => sale.id === autoCheckout.sale.id)?.deliveryFee)).toBe(8500);

  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0, { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotRoot, '10-final-summary.png'), fullPage: true });

  const allowedConsoleNoise = ['401 (Unauthorized)', '409 (Conflict)', 'favicon'];
  expect(consoleErrors.filter((entry) => !allowedConsoleNoise.some((allowed) => entry.includes(allowed)))).toEqual([]);
  expect(failedRequests).toEqual([]);
});
