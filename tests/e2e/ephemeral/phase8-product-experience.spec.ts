import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures/worker-auth';
import { captureBrowserErrors, expectAccessiblePage } from './accessibility';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Phase 8 product E2E tests.`);
  return value;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 20_000 });
}

async function isolatedPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: requiredEnv('EPHEMERAL_WEB_BASE_URL'),
  });
  return { context, page: await context.newPage() };
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.describe('Phase 8 enterprise product experience', () => {
  test('admin login opens the real overview and enterprise navigation', async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    await page.context().clearCookies();
    await login(
      page,
      requiredEnv('EPHEMERAL_ADMIN_EMAIL'),
      requiredEnv('EPHEMERAL_ADMIN_PASSWORD'),
    );

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu jornada en vivo' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();

    await page.getByTestId('nav-orders').click();
    await expect(page.getByTestId('orders-page')).toBeVisible();
    await page.getByTestId('nav-kitchen').click();
    await expect(page.getByTestId('kitchen-page')).toBeVisible();

    await expectAccessiblePage(page);
    expect(browserErrors).toEqual([]);
  });

  test('customer search and Customer 360 use real or explicit empty states', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByTestId('customers-page')).toBeVisible();

    const search = page.getByPlaceholder('Buscar por nombre o teléfono');
    await search.fill(`no-existent-phase8-${Date.now()}`);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('No hay resultados todavía');

    await page.goto('/customers');
    const profileLinks = page.getByRole('link', { name: /^Abrir perfil de / });
    await expect(profileLinks.first().or(page.getByRole('status'))).toBeVisible();
    if (await profileLinks.count()) {
      await profileLinks.first().click();
      await expect(page.getByTestId('customer-360-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Timeline verificable' })).toBeVisible();
    } else {
      await page.goto('/customers/e2e-customer-not-present');
      await expect(page.getByTestId('customer-360-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: /No se pudo cargar el perfil|No hay resultados todavía/ })).toBeVisible();
    }
  });

  test('order detail and kitchen expose governed state without mutating it', async ({ page }) => {
    const unsafeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && /\/orders\/[^/]+\/kitchen-transition(?:\?|$)/.test(request.url())) {
        unsafeRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto('/orders/e2e-order-fixture');
    await expect(page.getByTestId('order-detail-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedido #E2E-ORDER-0001' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estado financiero' })).toBeVisible();

    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-page')).toBeVisible();
    const seededOrder = page.getByRole('heading', { name: '#E2E-ORDER-0001' });
    const emptyKitchen = page.getByText('No hay pedidos pendientes en cocina');
    await expect(seededOrder.or(emptyKitchen)).toBeVisible();
    if (await seededOrder.isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: 'Iniciar preparación' })).toBeVisible();
    } else {
      await expect(emptyKitchen).toBeVisible();
    }

    expect(unsafeRequests).toEqual([]);
  });

  test('conversation handoff and support cases remain supervised and read-only', async ({ page }) => {
    const unsafeRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'GET'
        && (/\/admin\/sofia\/whatsapp\/conversations\/.+\/(?:pause|resume|take-over|release)/.test(request.url())
          || /\/admin\/customer-service\/cases\/.+\/transition/.test(request.url()))
      ) {
        unsafeRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto('/conversations');
    await expect(page.getByTestId('conversations-page')).toBeVisible();
    await expect(page.getByText('Receive-only', { exact: true })).toBeVisible();
    await expect(page.getByText('Outbound bloqueado', { exact: true })).toBeVisible();

    const conversationLinks = page.getByRole('link', { name: /^Abrir conversación de / });
    const emptyConversations = page.getByText('Sin conversaciones para este filtro');
    await expect(conversationLinks.first().or(emptyConversations)).toBeVisible();
    if (await conversationLinks.count()) {
      await conversationLinks.first().click();
      await expect(page.getByTestId('conversation-detail-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Estado operacional' })).toBeVisible();
    } else {
      await expect(emptyConversations).toBeVisible();
    }

    await page.goto('/customer-service');
    await expect(page.getByRole('heading', { name: 'Servicio al cliente' })).toBeVisible();
    const caseButtons = page.getByRole('button', { name: /^Abrir caso / });
    const emptyCases = page.getByText('No hay casos para estos filtros');
    await expect(caseButtons.first().or(emptyCases)).toBeVisible();
    if (await caseButtons.count()) {
      await caseButtons.first().click();
      await expect(page.getByRole('heading', { name: 'Expediente del caso' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Historial versionado' })).toBeVisible();
    } else {
      await expect(emptyCases).toBeVisible();
    }

    expect(unsafeRequests).toEqual([]);
  });

  test('CRM routes expose real empty states without campaign automation', async ({ page }) => {
    const routes = [
      '/crm',
      '/crm/leads',
      '/crm/pipelines',
      '/crm/tasks',
      '/crm/follow-ups',
      '/crm/segments',
      '/crm/activity',
      '/crm/recovery',
    ];

    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Application error');
    }

    await page.goto('/crm');
    await expect(page.getByText('Sin campañas automáticas')).toBeVisible();
  });

  test('UNKNOWN_RESULT never renders as verified payment success', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByRole('heading', { name: 'Pagos y evidencia' })).toBeVisible();
    await page.getByLabel('Estado').selectOption('UNKNOWN_RESULT');
    await expect(page.getByLabel('Estado')).toHaveValue('UNKNOWN_RESULT');
    await expect(page.getByText('Pago verificado', { exact: true })).toHaveCount(0);

    const visibleStatuses = page.getByText('Resultado desconocido', { exact: true });
    const emptyPaymentResults = page.getByText('No hay registros para estos filtros');
    await expect(visibleStatuses.first().or(emptyPaymentResults)).toBeVisible();
    if (await visibleStatuses.count()) {
      await expect(visibleStatuses.first()).toBeVisible();
    } else {
      await expect(emptyPaymentResults).toBeVisible();
    }
  });

  test('activation control keeps Bold, outbound and auto reply disabled', async ({ page }) => {
    await page.goto('/activation-control');
    await expect(page.getByRole('heading', { name: 'Control de activación' })).toBeVisible();
    const disabledActivations = page.getByRole('listitem').filter({ hasText: 'Deshabilitado' });
    await expect(disabledActivations.filter({ hasText: 'Bold real' })).toBeVisible();
    await expect(disabledActivations.filter({ hasText: 'WhatsApp outbound' })).toBeVisible();
    await expect(disabledActivations.filter({ hasText: 'Auto reply' })).toBeVisible();
    await expect(page.getByRole('button', { name: /activar.*(?:Bold|WhatsApp|auto reply)/i })).toHaveCount(0);
  });

  test('cashier route RBAC denies privileged financial evidence', async ({ browser }) => {
    const { context, page } = await isolatedPage(browser);
    try {
      await login(
        page,
        requiredEnv('EPHEMERAL_CASHIER_EMAIL'),
        requiredEnv('EPHEMERAL_CASHIER_PASSWORD'),
      );
      await page.goto('/payments');
      await expect(page.getByRole('heading', { name: 'No tienes permisos para este módulo' })).toBeVisible();
      await expect(page.getByTestId('nav-payments')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('mobile shell is responsive, keyboard-governed and route-capable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Tu jornada en vivo' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const menu = page.getByRole('button', { name: 'Abrir menú de navegación' });
    await menu.focus();
    await menu.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    await expect(page.getByTestId('nav-customers')).toBeVisible();
    await page.getByTestId('nav-customers').click();
    await expect(page.getByTestId('customers-page')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessiblePage(page);
  });
});
