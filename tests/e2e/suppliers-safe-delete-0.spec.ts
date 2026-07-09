import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-final-pending-issues-closure-0';

async function gotoSuppliers(page: import('@playwright/test').Page) {
  await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page, 'suppliers redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('suppliers-list')).toBeVisible({ timeout: 15000 });
}

test.describe('suppliers safe delete', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('deletes suppliers without history and blocks unsafe delete with clear message', async ({
    page,
    request,
    workerAccessToken,
  }) => {
    await gotoSuppliers(page);
    await page.screenshot({ path: path.join(screenshotsDir, '01-suppliers-list-actions.png'), fullPage: true });

    const supplierName = `E2E Delete Safe ${Date.now()}`;
    const createResponse = await request.post('/api/suppliers', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { name: supplierName, taxId: `E2E-DEL-${Date.now()}` },
    });
    expect(createResponse.status()).toBe(201);
    const supplier = await createResponse.json();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Buscar proveedor...').fill(supplierName);
    await expect(page.getByText(supplierName)).toBeVisible();
    await page.getByTestId('supplier-detail-button').first().click();
    await page.getByTestId('supplier-delete-button').click();
    await expect(page.getByTestId('supplier-delete-confirm-modal')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, '02-supplier-delete-without-history-success.png'), fullPage: true });
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText(supplierName)).toHaveCount(0, { timeout: 15000 });

    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            message:
              'No se puede eliminar este proveedor porque tiene historial. Puedes desactivarlo para evitar nuevas compras.',
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.getByPlaceholder('Buscar proveedor...').fill('');
    await page.getByTestId('supplier-detail-button').first().click();
    await page.getByTestId('supplier-delete-button').click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText(/historial/i)).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '03-supplier-delete-with-history-blocked.png'), fullPage: true });
  });

  test('inactive supplier is not offered for new purchases', async ({ page, request, workerAccessToken }) => {
    const inactiveName = `E2E Inactivo ${Date.now()}`;
    const createResponse = await request.post('/api/suppliers', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { name: inactiveName, taxId: `E2E-INACTIVE-${Date.now()}` },
    });
    expect(createResponse.status()).toBe(201);
    const supplier = await createResponse.json();

    const deactivate = await request.patch(`/api/suppliers/${supplier.id}`, {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { isActive: false },
    });
    expect(deactivate.status()).toBe(200);

    await page.goto('/purchases', { waitUntil: 'domcontentloaded' });
    await expect(page, 'purchases redirected to login').not.toHaveURL(/\/login/);
    await expect(page.getByTestId('purchase-supplier')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('purchase-supplier')).not.toContainText(inactiveName);
    await page.screenshot({ path: path.join(screenshotsDir, '04-supplier-inactive-purchase-blocked.png'), fullPage: true });
  });
});
