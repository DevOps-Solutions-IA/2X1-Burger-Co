import { expect, test } from '@playwright/test';

const protectedRoutes = ['/deliveries', '/settings', '/tables'];
const publicStaffRoutes = ['/waiter/login', '/delivery/login'];

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  if (!(await page.getByTestId('login-email').isVisible().catch(() => false))) {
    return;
  }

  await page.getByTestId('login-email').fill('admin@2x1burger.co');
  await page.getByTestId('login-password').fill('DevAdmin12345*');
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}

async function gotoProtected(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);
  await ensureAuthenticated(page);
  if (!page.url().endsWith(route)) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await Promise.race([
      page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
      page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    ]);
    await ensureAuthenticated(page);
  }
  await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
}

test.describe('SYS-2: secondary operational modules coverage', () => {
  test.setTimeout(90000);

  test('admin secondary routes load and reload without logout', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (request.url().includes('/api/') && failure !== 'net::ERR_ABORTED') {
        failedRequests.push(`${request.method()} ${request.url()} -> ${failure}`);
      }
    });

    for (const route of protectedRoutes) {
      await gotoProtected(page, route);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page, `${route} redirected to login after reload`).not.toHaveURL(/\/login/);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    }

    expect(failedRequests, `failed API requests:\n${failedRequests.join('\n')}`).toEqual([]);
  });

  test('waiter and delivery login surfaces remain reachable without admin logout side effects', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL ?? 'http://localhost' });
    const page = await context.newPage();
    try {
      for (const route of publicStaffRoutes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')));
        await expect(page.locator('main, form').first()).toBeVisible({ timeout: 15000 });
      }
    } finally {
      await context.close();
    }
  });

  test('WhatsApp unavailable is treated as operational state, not auth failure', async ({ page }) => {
    await page.route('**/api/sales**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'sys2-secondary-whatsapp',
            number: 'SYS2-WA',
            status: 'PAID',
            soldAt: new Date().toISOString(),
            channel: 'MOSTRADOR',
            tableLabel: null,
            deliveryReference: null,
            customerName: 'Cliente WhatsApp SYS-2',
            customerPhone: '3001234567',
            notes: null,
            total: 12000,
            subtotal: 12000,
            items: [
              {
                quantity: 1,
                unitPrice: 12000,
                totalPrice: 12000,
                product: { name: 'Producto SYS-2' },
              },
            ],
            conversion: null,
          },
        ]),
      });
    });
    await page.route('**/api/whatsapp/session', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'WhatsApp no conectado' }),
      });
    });

    await gotoProtected(page, '/cash');
    await page.getByRole('button', { name: 'Enviar o reenviar por WhatsApp' }).click();
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-whatsapp-card')).toBeVisible();
  });
});
