import { expect, test, type Page } from '@playwright/test';
import { captureBrowserErrors, expectAccessiblePage } from './accessibility';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for ephemeral UI tests.`);
  return value;
}

const email = requiredEnv('EPHEMERAL_ADMIN_EMAIL');
const password = requiredEnv('EPHEMERAL_ADMIN_PASSWORD');

async function login(page: Page) {
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await page.goto('/login');
  }
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('operator console handles authentication, safe navigation and logout', async ({ page }) => {
  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/login');
  await page.getByTestId('login-email').fill('no-access.e2e@invalid.local');
  await page.getByTestId('login-password').fill('incorrect-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expectAccessiblePage(page);

  const browserErrors = captureBrowserErrors(page);
  await login(page);

  const routes = [
    ['/dashboard', '/dashboard', 'dashboard-page'],
    ['/cash', '/cash', 'cash-page'],
    ['/pos', '/pos', 'pos-page'],
    ['/deliveries', '/deliveries', 'deliveries-queue-list'],
    ['/inventory', '/inventory', 'inventory-page'],
    ['/users', '/team', 'team-page'],
    ['/sofia', '/sofia', 'sofia-admin-page'],
    ['/sofia/conversations', '/conversations', 'conversations-page'],
    ['/sofia/whatsapp-qr', '/sofia/whatsapp-qr', 'sofia-whatsapp-qr-page'],
    ['/sofia/customers', '/customers', 'customers-page'],
  ] as const;

  for (const [route, expectedRoute, testId] of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${expectedRoute.replaceAll('/', '\\/')}/?$`));
    if (testId) await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expectAccessiblePage(page);
  }

  await page.goto('/sofia');
  await expect(page.getByTestId('sofia-main-real-data-hero')).toBeVisible();
  await expect(page.locator('body')).toContainText(/Envío real:\s*bloqueado/i);
  await expect(page.locator('body')).toContainText(/Producción\s*Bloqueada/i);
  await page.goto('/sofia/whatsapp-qr');
  await expect(page.locator('body')).toContainText(/Deshabilitado|DISABLED/i);
  await expect(page.locator('body')).not.toContainText('QR real de WhatsApp disponible para escanear');
  await expectAccessiblePage(page);

  await page.goto('/sofia/customers');
  await expect(page).toHaveURL(/\/customers\/?$/);
  await expect(page.getByTestId('customers-page')).toBeVisible();
  await expect(page.locator('body')).toContainText('Identidades enmascaradas y timeline sanitizado');
  await expectAccessiblePage(page);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  expect(serverFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
});
