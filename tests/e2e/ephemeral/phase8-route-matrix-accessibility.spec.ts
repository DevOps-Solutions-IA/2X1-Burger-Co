import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures/worker-auth';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

// Every static authenticated App Router page plus dynamic pages backed by the
// deterministic fixture identities created for this isolated database.
const ADMIN_ROUTES = [
  '/activation-control',
  '/analytics',
  '/audit',
  '/cash',
  '/categories',
  '/conversations',
  '/conversations/e2e-conversation-fixture',
  '/crm',
  '/crm/activity',
  '/crm/follow-ups',
  '/crm/leads',
  '/crm/pipelines',
  '/crm/recovery',
  '/crm/segments',
  '/crm/tasks',
  '/customer-service',
  '/customers',
  '/customers/e2e-crm-customer',
  '/dashboard',
  '/deliveries',
  '/expenses',
  '/ingredients',
  '/inventory',
  '/kitchen',
  '/orders',
  '/orders/e2e-order-fixture',
  '/overview',
  '/payments',
  '/pos',
  '/products',
  '/purchases',
  '/recipes',
  '/reports',
  '/settings',
  '/sofia',
  '/sofia/conversations',
  '/sofia/customers',
  '/sofia/customers/e2e-crm-customer',
  '/sofia/whatsapp-qr',
  '/suppliers',
  '/tables',
  '/team',
  '/users',
] as const;

const READ_ONLY_POST_PATHS = new Set([
  '/api/admin/sofia/crm/customers/search',
  '/api/orders/operations/list',
  '/api/orders/kitchen/queue',
]);

const INVENTORY_ROUTES = [
  '/categories',
  '/ingredients',
  '/inventory',
  '/products',
  '/purchases',
  '/recipes',
  '/reports',
  '/suppliers',
] as const;

const INVENTORY_DENIED_ROUTES = [
  '/audit',
  '/conversations',
  '/crm',
  '/customers',
  '/deliveries',
  '/kitchen',
  '/orders',
  '/sofia',
  '/tables',
] as const;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Phase 8 route matrix.`);
  return value;
}

function observeOperationalMutations(page: Page) {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' || request.method() === 'HEAD') return;
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/auth\/(?:login|refresh)$/.test(pathname)) return;
    if (request.method() === 'POST' && READ_ONLY_POST_PATHS.has(pathname)) return;
    mutations.push(`${request.method()} ${pathname}`);
  });
  return mutations;
}

async function waitForResolvedInterface(page: Page) {
  const visibleBusyRegions = page.locator('main [aria-busy="true"]:visible');
  const visibleLoadingPlaceholders = page.locator('main [class*="animate-pulse"]:visible');

  await expect.poll(
    async () => {
      if ((await visibleBusyRegions.count()) || (await visibleLoadingPlaceholders.count())) return false;
      await page.waitForTimeout(250);
      return (await visibleBusyRegions.count()) === 0 && (await visibleLoadingPlaceholders.count()) === 0;
    },
    {
      message: 'the operational interface must settle before accessibility analysis',
      timeout: 20_000,
      intervals: [100, 250, 500],
    },
  ).toBe(true);

  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function expectResponsiveAccessibleRoute(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
  await expect(page.getByTestId('protected-route-loading')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'No tienes permisos para este módulo' })).toHaveCount(0);
  await expect(page.locator('main:visible')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('Application error');
  await waitForResolvedInterface(page);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content, `${route} must not overflow horizontally`).toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );

  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blockingViolations = result.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
  expect(blockingViolations, `${route} must have no serious or critical Axe violations`).toEqual([]);
}

async function createInventoryContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: requiredEnv('EPHEMERAL_WEB_BASE_URL') });
  const response = await context.request.post('/api/auth/login', {
    data: {
      email: requiredEnv('EPHEMERAL_INVENTORY_EMAIL'),
      password: requiredEnv('EPHEMERAL_INVENTORY_PASSWORD'),
    },
  });
  expect(response.status()).toBe(201);
  return context;
}

async function installReadOnlyProfile(page: Page) {
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    const profile = await response.json() as { permissions?: string[] };
    await route.fulfill({
      response,
      json: {
        ...profile,
        permissions: (profile.permissions ?? []).filter((permission) => permission.endsWith('.read')),
      },
    });
  });
}

test.describe('Phase 8 authenticated route accessibility matrix', () => {
  test('active navigation and read-only capabilities remain explicit', async ({ page }) => {
    const mutations = observeOperationalMutations(page);
    await installReadOnlyProfile(page);

    await page.goto('/categories', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-categories')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Modo consulta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nueva categoría' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);

    await page.goto('/deliveries', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('deliveries-read-only')).toBeVisible();
    const firstDelivery = page.getByTestId(/deliveries-(?:sofia-)?queue-item/).first();
    if (await firstDelivery.count()) await firstDelivery.click();
    for (const testId of ['deliveries-assign-button', 'deliveries-delivered-button', 'deliveries-incident-button']) {
      const control = page.getByTestId(testId);
      if (await control.count()) await expect(control).toBeDisabled();
    }

    expect(mutations).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`admin routes are responsive and accessible at ${viewport.name} width`, async ({ page }) => {
      test.setTimeout(8 * 60_000);
      const mutations = observeOperationalMutations(page);
      await page.setViewportSize(viewport);

      for (const route of ADMIN_ROUTES) {
        await test.step(route, async () => expectResponsiveAccessibleRoute(page, route));
      }

      expect(mutations).toEqual([]);
    });

    test(`inventory routes are responsive and accessible at ${viewport.name} width`, async ({ browser }) => {
      test.setTimeout(4 * 60_000);
      const context = await createInventoryContext(browser);
      const page = await context.newPage();
      const mutations = observeOperationalMutations(page);
      await page.setViewportSize(viewport);

      try {
        for (const route of INVENTORY_ROUTES) {
          await test.step(route, async () => expectResponsiveAccessibleRoute(page, route));
        }
        for (const route of INVENTORY_DENIED_ROUTES) {
          await test.step(`${route} denied`, async () => {
            await page.goto(route, { waitUntil: 'domcontentloaded' });
            await expect(page.getByRole('heading', { name: 'No tienes permisos para este módulo' })).toBeVisible();
          });
        }
        await expect(page.getByRole('button', { name: 'Buscar en toda la operación' })).toHaveCount(0);
        await expect(page.getByTestId('nav-overview')).toHaveCount(0);
        expect(mutations).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
