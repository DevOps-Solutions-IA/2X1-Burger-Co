import { expect, test, type Page } from '@playwright/test';

const email = process.env.EPHEMERAL_ADMIN_EMAIL;
const password = process.env.EPHEMERAL_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Ephemeral admin credentials are required.');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('admin navigation loads critical modules without API/server failures', async ({ page }) => {
  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });
  await login(page);

  const routes = [
    ['/dashboard', 'dashboard-page'],
    ['/cash', 'cash-page'],
    ['/pos', 'pos-page'],
    ['/deliveries', 'deliveries-queue-list'],
    ['/inventory', null],
    ['/users', null],
    ['/sofia', 'sofia-admin-page'],
    ['/sofia/conversations', null],
    ['/sofia/whatsapp-qr', null],
  ] as const;

  for (const [route, testId] of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(route.replaceAll('/', '\\/')));
    if (testId) await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  }
  expect(serverFailures).toEqual([]);
});

test('invalid login shows an honest error state', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('no-access.e2e@invalid.local');
  await page.getByTestId('login-password').fill('incorrect-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('Sofia and WhatsApp show safe runtime state', async ({ page }) => {
  await login(page);
  await page.goto('/sofia');
  await expect(page.getByTestId('sofia-main-real-data-hero')).toBeVisible();
  await expect(page.locator('body')).toContainText(/Envío real:\s*bloqueado/i);
  await expect(page.locator('body')).toContainText(/Producción\s*Bloqueada/i);
  await page.goto('/sofia/whatsapp-qr');
  await expect(page.locator('body')).toContainText(/Deshabilitado|DISABLED/i);
  await expect(page.locator('body')).not.toContainText('QR real de WhatsApp disponible para escanear');
});

test('logout invalidates the browser session', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});
