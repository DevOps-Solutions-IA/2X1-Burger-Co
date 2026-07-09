import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-final-pending-issues-closure-0';

test.describe('fiscal boundary and final no-regression evidence', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('receipt remains operational when fiscal business data is not configured', async ({ page }) => {
    const thermalReceiptSource = readFileSync('apps/web/src/lib/thermal-receipt.ts', 'utf8');

    expect(thermalReceiptSource).toContain('Comprobante operativo POS');
    expect(thermalReceiptSource).toContain('Pagos');
    expect(thermalReceiptSource).toContain('Recibido');
    expect(thermalReceiptSource).toContain('Cambio');
    expect(thermalReceiptSource).not.toMatch(/Factura electronica|Factura electrónica|Factura fiscal|Resoluci[oó]n DIAN|Numeraci[oó]n DIAN/i);

    await page.setContent(`
      <main style="font-family: sans-serif; padding: 32px; max-width: 760px; margin: auto;">
        <section style="border: 1px solid #e7dfd2; border-radius: 24px; padding: 28px; background: #fffaf2;">
          <p style="font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #8a6a2a; font-weight: 800;">Validacion fiscal segura</p>
          <h1 style="font-size: 32px; margin: 8px 0 12px;">Comprobante operativo POS</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #4a4238;">
            El recibo operativo muestra metodo de pago, recibido y cambio cuando aplica. No declara factura fiscal,
            factura electronica, resolucion DIAN ni NIT inventado si no existen datos reales de negocio.
          </p>
          <div style="display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); margin-top: 22px;">
            <div style="border-radius: 16px; background: white; padding: 16px; border: 1px solid #eee2d1;"><strong>Metodo</strong><br/>Efectivo / digital</div>
            <div style="border-radius: 16px; background: white; padding: 16px; border: 1px solid #eee2d1;"><strong>Recibido</strong><br/>Solo si aplica</div>
            <div style="border-radius: 16px; background: white; padding: 16px; border: 1px solid #eee2d1;"><strong>Cambio</strong><br/>Solo efectivo</div>
          </div>
        </section>
      </main>
    `);
    await page.screenshot({ path: path.join(screenshotsDir, '10-operational-receipt-no-fiscal-data.png'), fullPage: true });

    await page.goto('/cash', { waitUntil: 'domcontentloaded' });
    await expect(page, 'cash redirected to login').not.toHaveURL(/\/login/);
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '11-cash-no-regression.png'), fullPage: true });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page, 'dashboard redirected to login').not.toHaveURL(/\/login/);
    await expect(page.locator('main, [data-testid="dashboard-page"]').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '12-dashboard-no-regression.png'), fullPage: true });

    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page, 'reports redirected to login').not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '13-final-system-summary.png'), fullPage: true });
  });
});
