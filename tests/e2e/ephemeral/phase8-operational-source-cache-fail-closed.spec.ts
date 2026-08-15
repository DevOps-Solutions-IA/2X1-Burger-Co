import { expect, test } from '../fixtures/worker-auth';

const unavailable = {
  status: 503,
  contentType: 'application/json',
  body: JSON.stringify({ message: 'authoritative source unavailable' }),
};

test.describe('Phase 8 operational sources fail closed', () => {
  test('POS stops trusting cached table data after a polling failure', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('pos-page')).toBeVisible();
    await page.getByTestId('pos-delivery-mode').selectOption('DINE_IN');
    await expect(page.getByTestId('order-table-select')).toBeVisible();
    await expect(page.getByText('No se puede guardar ni cobrar mientras una fuente operativa requerida esté sin verificar.')).toHaveCount(0);

    await page.route('**/api/tables', (route) => route.fulfill(unavailable));

    await expect(page.getByText('No se puede guardar ni cobrar mientras una fuente operativa requerida esté sin verificar.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pos-delivery-save')).toBeDisabled();
  });

  test('purchase and expense writes stay disabled when required sources fail', async ({ page }) => {
    let writeRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/(purchases|expenses)$/.test(request.url())) writeRequests += 1;
    });
    await page.route('**/api/payment-methods', (route) => route.fulfill(unavailable));

    await page.goto('/purchases', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('El formulario de compra no tiene todos sus catálogos disponibles')).toBeVisible();
    await expect(page.getByTestId('purchase-submit')).toBeDisabled();

    await page.goto('/expenses', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Parte de la operación financiera no está disponible')).toBeVisible();
    await expect(page.getByTestId('expense-submit')).toBeDisabled();
    expect(writeRequests).toBe(0);
  });

  test('orders and kitchen expose unavailable authority instead of connected status', async ({ page }) => {
    await page.route('**/api/orders/operations/list', (route) => route.fulfill(unavailable));
    await page.route('**/api/orders/kitchen/queue', (route) => route.fulfill(unavailable));

    await page.goto('/orders', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Datos sin verificar')).toBeVisible();
    await expect(page.getByText('Datos operativos')).toHaveCount(0);

    await page.goto('/kitchen', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Cola sin verificar')).toBeVisible();
    await expect(page.getByText('Cola conectada')).toHaveCount(0);
  });
});
