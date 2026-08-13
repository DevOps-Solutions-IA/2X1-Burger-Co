import { expect, test } from '../fixtures/worker-auth';
import { expectAccessiblePage } from './accessibility';

test.describe('Phase 8 dialog and financial form accessibility', () => {
  test('destructive confirmation traps focus, closes with Escape and never mutates when cancelled', async ({ page }) => {
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && /\/api\/products(?:\/|\?|$)/.test(request.url())) {
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.goto('/products');
    const trigger = page.getByRole('button', { name: /^Eliminar .+/ }).first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Eliminar producto' });
    const close = dialog.getByRole('button', { name: 'Cerrar' });
    const confirm = dialog.getByRole('button', { name: 'Eliminar', exact: true });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await close.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await confirm.press('Tab');
    await expect(close).toBeFocused();
    await expectAccessiblePage(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(mutations).toEqual([]);
  });

  test('global search dialog preserves a bounded keyboard cycle and restores focus', async ({ page }) => {
    await page.goto('/overview');
    const trigger = page
      .getByRole('button', { name: /Buscar clientes, pedidos y conversaciones/ })
      .first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Control+k');

    const dialog = page.getByRole('dialog', { name: 'Busqueda global' });
    const close = dialog.getByRole('button', { name: 'Cerrar panel' });
    const input = dialog.getByLabel('Buscar');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await close.press('Shift+Tab');
    await expect(input).toBeFocused();
    await input.press('Tab');
    await expect(close).toBeFocused();
    await expectAccessiblePage(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('POS financial fields have programmatic labels and a logical keyboard order', async ({ page }) => {
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && /\/api\/(?:orders|sales|cash-register)(?:\/|\?|$)/.test(request.url())) {
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.goto('/pos');
    const seededOrder = page.getByTestId('order-card-e2e-order-0001');
    await expect(seededOrder).toBeVisible();
    await seededOrder.click();

    const method = page.getByLabel('Método de pago');
    const amount = page.getByLabel('Aplicado');
    const received = page.getByLabel('Recibido');
    await expect(method).toBeVisible();
    await expect(amount).toBeVisible();
    await expect(received).toBeVisible();

    await method.focus();
    await method.press('Tab');
    await expect(amount).toBeFocused();
    await amount.press('Tab');
    await expect(received).toBeFocused();
    await expectAccessiblePage(page);

    expect(mutations).toEqual([]);
  });
});
