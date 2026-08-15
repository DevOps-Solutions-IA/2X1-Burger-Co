import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures/worker-auth';
import { captureBrowserErrors, expectAccessiblePage } from './accessibility';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Phase 8 product E2E tests.`);
  return value;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  if (/\/dashboard\/?$/.test(page.url())) return;
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 20_000 });
}

async function loginViaApi(page: Page, email: string, password: string) {
  const response = await page.context().request.post('/api/auth/login', {
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
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

  test('customer search opens the seeded Customer 360 read model', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByTestId('customers-page')).toBeVisible();

    const search = page.getByPlaceholder('Buscar por nombre o teléfono');
    await search.fill('E2E Customer 360');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('link', { name: 'Abrir perfil de E2E Customer 360' }).click();
    await expect(page).toHaveURL(/\/customers\/e2e-crm-customer$/);
    await expect(page.getByTestId('customer-360-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timeline verificable' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Relaciones operativas' })).toBeVisible();
    for (const relation of ['Órdenes y checkout', 'Pagos', 'Entrega', 'Casos de servicio', 'Conversaciones']) {
      await expect(page.getByRole('heading', { name: relation })).toBeVisible();
    }
    await expect(page.getByText('Resultado desconocido: no equivale a pago confirmado.')).toBeVisible();
    await expect(page.getByText('Resultado de pago incierto; requiere revisión humana.')).toBeVisible();
    await expect(page.getByText('E2E Customer 360', { exact: true }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('573000002399');
    await expect(page.locator('body')).not.toContainText('+57 300 000 2399');

    await expect(page.locator('a[href="/orders/e2e-delivery-fixture"]')).toBeVisible();
    await page.locator('a[href="/orders/e2e-delivery-fixture"]').click();
    await expect(page).toHaveURL(/\/orders\/e2e-delivery-fixture$/);
    await page.goBack();
    await expect(page.getByTestId('customer-360-page')).toBeVisible();

    await page.locator('a[href="/conversations/e2e-conversation-fixture"]').click();
    await expect(page).toHaveURL(/\/conversations\/e2e-conversation-fixture$/);
  });

  test('order detail and kitchen execute one governed transition', async ({ page }) => {
    await page.goto('/orders/e2e-order-fixture');
    await expect(page.getByTestId('order-detail-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedido #E2E-ORDER-0001' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estado financiero' })).toBeVisible();

    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-page')).toBeVisible();
    const seededOrder = page.getByRole('article').filter({ hasText: '#E2E-ORDER-0001' });
    await expect(seededOrder).toBeVisible();
    await seededOrder.getByRole('button', { name: 'Iniciar preparación' }).click();
    await expect(seededOrder.getByText('En preparación', { exact: true })).toBeVisible();
  });

  test('conversation handoff and support case use governed versioned transitions', async ({ page }) => {
    await page.goto('/conversations');
    await expect(page.getByTestId('conversations-page')).toBeVisible();
    await expect(page.getByText('Receive-only', { exact: true })).toBeVisible();
    await expect(page.getByText('Outbound bloqueado', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Abrir conversación de E2E Customer 360' }).click();
    await expect(page).toHaveURL(/\/conversations\/e2e-conversation-fixture$/);
    await expect(page.getByTestId('conversation-detail-page')).toBeVisible();
    await page.getByRole('button', { name: 'Tomar conversación' }).click();
    await expect(page.getByText('Human taken', { exact: true })).toBeVisible();

    await page.goto('/customer-service?case=e2e-service-case-fixture');
    await expect(page.getByRole('heading', { name: 'Servicio al cliente' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Expediente del caso' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Historial versionado' })).toBeVisible();
    await page.getByPlaceholder('Ej. revisión solicitada').fill('revision_e2e');
    await page.getByRole('button', { name: 'Solicitar atención humana' }).click();
    await expect(page.getByRole('heading', { name: 'Abierto → Requiere humano' })).toBeVisible();
  });

  test('CRM routes expose real records and governed lead/task mutations', async ({ page }) => {
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

    await page.goto('/crm/leads');
    const leadRow = page.getByRole('row').filter({ hasText: 'E2E Governed Lead' });
    await leadRow.getByRole('button', { name: 'Mover' }).click();
    await page.getByRole('button', { name: 'Confirmar transición' }).click();
    await expect(leadRow.locator('[data-status="QUALIFIED"]')).toBeVisible();

    await page.goto('/crm/tasks');
    const taskRow = page.getByRole('row').filter({ hasText: 'E2E Call Customer' });
    await taskRow.getByRole('button', { name: 'Iniciar' }).click();
    await expect(taskRow.getByText('En curso', { exact: true })).toBeVisible();
  });

  test('financial review overrides intent status and never renders as verified payment success', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByRole('heading', { name: 'Pagos y evidencia' })).toBeVisible();
    await page.getByLabel('Estado').selectOption('FINANCIAL_REVIEW_REQUIRED');
    await expect(page.getByLabel('Estado')).toHaveValue('FINANCIAL_REVIEW_REQUIRED');
    await expect(page.getByText('Pago verificado', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Revisión financiera', { exact: true }).first()).toBeVisible();
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
      await loginViaApi(
        page,
        requiredEnv('EPHEMERAL_CASHIER_EMAIL'),
        requiredEnv('EPHEMERAL_CASHIER_PASSWORD'),
      );
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await page.goto('/payments');
      await expect(page.getByRole('heading', { name: 'No tienes permisos para este módulo' })).toBeVisible();
      await expect(page.getByTestId('nav-payments')).toHaveCount(0);

      await page.goto('/customers/e2e-crm-customer');
      await expect(page.getByTestId('customer-360-page')).toBeVisible();
      await expect(page.locator('a[href^="/payments"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/customer-service"]')).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
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
