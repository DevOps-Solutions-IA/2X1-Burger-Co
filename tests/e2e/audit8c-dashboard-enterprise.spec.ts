import { expect, test } from '@playwright/test';

const BASE = 'http://localhost';
const SCREENSHOT_DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8c-dashboard-deepseek-enterprise-fix';

test.describe('AUDIT-8C: Dashboard Enterprise Fix', () => {
  test.setTimeout(60000);

  test('dashboard loads with enterprise redesign', async ({ page }) => {
    // Login
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="login-email"]', 'admin@2x1burger.co');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Screenshots at 3 viewports
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/dashboard-1440.png`, fullPage: true });

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/tablet/dashboard-1024.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/dashboard-390.png`, fullPage: true });

    // Verify OLD copy is gone
    await expect(page.getByText('Panel de operación')).toHaveCount(0);
    await expect(page.getByText('Pulso operativo')).toHaveCount(0);
    await expect(page.getByText('Productos con mejor salida')).toHaveCount(0);
    await expect(page.getByText('Actividad reciente')).toHaveCount(0);

    // Verify NEW copy is present
    await expect(page.getByText('Tu jornada en vivo')).toBeVisible();
    await expect(page.getByText('Accesos rápidos')).toBeVisible();
    await expect(page.getByText('Estado del día')).toBeVisible();
    await expect(page.getByText('Lo más vendido')).toBeVisible();
    await expect(page.getByText('Última actividad')).toBeVisible();

    // Verify greeting exists
    const greeting = page.getByText(/Buenos días|Buenas tardes|Buenas noches/);
    await expect(greeting.first()).toBeVisible();

    // Verify QuickActions are separate section
    await expect(page.getByText('Abrir POS')).toBeVisible();
    await expect(page.getByText('Ir a caja')).toBeVisible();
    await expect(page.getByText('Ver inventario')).toBeVisible();

    // Verify KPIs
    await expect(page.getByText('Ventas hoy')).toBeVisible();
    await expect(page.getByText('Gastos')).toBeVisible();
    await expect(page.getByText('Utilidad neta')).toBeVisible();
  });
});
