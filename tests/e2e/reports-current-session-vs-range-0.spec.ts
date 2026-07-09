import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-final-pending-issues-closure-0';

test.describe('reports current session vs custom range', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('uses operational report by default and range report only after date/mode change', async ({ page }) => {
    let operationalSeen = false;
    let rangeSeen = false;
    let operationalPdfSeen = false;

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/reports/operational') && !url.includes('/pdf')) {
        operationalSeen = true;
      }
      if (url.includes('/api/reports/range')) {
        rangeSeen = true;
      }
    });

    await page.route('**/api/reports/operational/pdf', async (route) => {
      operationalPdfSeen = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from('%PDF-1.4\n% operational report evidence\n%%EOF'),
      });
    });

    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page, 'reports redirected to login').not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('reports-mode-badge')).toContainText('Jornada actual');
    await expect(page.getByTestId('reports-mode-description')).toContainText('Desde apertura de caja');
    await expect.poll(() => operationalSeen, { message: 'operational report request was not sent' }).toBe(true);
    expect(rangeSeen, 'range report must not be the default summary source').toBe(false);

    await page.screenshot({ path: path.join(screenshotsDir, '05-reports-current-session-default.png'), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, '06-reports-current-session-badge.png'), fullPage: true });

    await page.getByTestId('reports-open-pdf').click();
    await expect.poll(() => operationalPdfSeen, { message: 'operational PDF endpoint was not requested' }).toBe(true);
    await page.screenshot({ path: path.join(screenshotsDir, '09-reports-pdf-button-still-working.png'), fullPage: true });

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('reports-date-from').fill(yesterday);
    await expect(page.getByTestId('reports-mode-badge')).toContainText('Rango personalizado');
    await expect(page.getByTestId('reports-range-label')).toContainText(yesterday);
    await expect(page.getByTestId('reports-mode-description')).toContainText('Puede no coincidir con la jornada actual');
    await expect.poll(() => rangeSeen, { message: 'custom range report request was not sent' }).toBe(true);

    await page.screenshot({ path: path.join(screenshotsDir, '07-reports-custom-range-mode.png'), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, '08-reports-custom-range-explanation.png'), fullPage: true });
  });
});
