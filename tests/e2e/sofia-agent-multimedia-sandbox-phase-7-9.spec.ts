import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-phase-7-9-go-closure-fix-0',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(210_000);

async function processMessage(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('sofia-sandbox-message').fill(text);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        (response.url().includes('/api/admin/sofia/agent/process') ||
          response.url().includes('/api/admin/sofia/sandbox/commercial-message')) &&
        response.status() === 201,
    ),
    page.getByTestId('sofia-sandbox-process').click(),
  ]);
  await expect(page.getByTestId('sofia-agent-response')).toBeVisible({ timeout: 20000 });
}

test('Sofia sandbox processes typos, multimedia, upsell and recovery without operational effects', async ({ page }) => {
  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia sandbox redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('sofia-sandbox-phone').fill(`573001${Date.now().toString().slice(-6)}`);
  await expect(page.getByTestId('sofia-featured-offers')).toBeVisible();
  await expect(page.getByTestId('sofia-featured-offers')).toContainText('Catálogo aún no consultado');
  await expect(page.getByTestId('sofia-featured-offer-maxi-family')).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-sandbox-catalogo-visual.png'), fullPage: true });
  await page.getByTestId('sofia-featured-offers').screenshot({ path: path.join(screenshotsDir, '02-sofia-featured-offers.png') });

  await processMessage(page, 'qué combos tienen');
  await expect(page.getByTestId('sofia-featured-offer-maxi-family')).toContainText('Maxi Family');
  await expect(page.getByTestId('sofia-featured-offer-2x1-hamburguesas')).toContainText('2x1 Hamburguesas');
  await expect(page.getByTestId('sofia-featured-offer-doble-todo')).toContainText('Doble Todo');
  await expect(page.getByTestId('sofia-featured-offer-hamburguesa-sencilla')).toContainText('Hamburguesa Sencilla');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('Maxi Family');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('porción personal de papitas');
  await expect(page.getByTestId('sofia-featured-offer-image-maxi-family')).toContainText('/uploads/sofia-offers/maxi-family.webp');

  await processMessage(page, 'kiero una hamburgesa 2x1 con domisilio');
  await expect(page.getByTestId('sofia-agent-intent')).toContainText('ORDER_ITEM');
  await expect(page.getByTestId('sofia-agent-extracted-items')).toContainText(/Hamburguesa|Burger/i);
  await expect(page.getByTestId('sofia-agent-response')).toContainText('Solo me falta la dirección');
  await expect(page.getByTestId('sofia-agent-upsell')).toContainText('Te puedo recomendar');
  await expect(page.getByTestId('sofia-agent-media-path')).toContainText('/uploads/sofia-offers/2x1-hamburguesas.webp');
  await page.screenshot({ path: path.join(screenshotsDir, '02-message-with-typos-detected.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '03-product-real-detected.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '04-missing-address-question.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '05-upsell-suggestion.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '07-media-suggestion.png'), fullPage: true });

  await processMessage(page, 'quiero un maxi family');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('6 burgers');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('porción personal de papitas');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('Pepsi 1.5 L');
  await expect(page.getByTestId('sofia-agent-upsell')).toContainText('porciones adicionales');
  await expect(page.getByTestId('sofia-agent-response')).not.toContainText('papas familiares');
  await expect(page.getByTestId('sofia-agent-response')).not.toContainText('papas grandes');
  await expect(page.getByTestId('sofia-agent-response')).not.toContainText('papas para todos');
  await page.screenshot({ path: path.join(screenshotsDir, '03-maxi-family-copy-correcto.png'), fullPage: true });

  await processMessage(page, 'mándame foto del maxi');
  await expect(page.getByTestId('sofia-agent-media-path')).toContainText('/uploads/sofia-offers/maxi-family.webp');
  await page.screenshot({ path: path.join(screenshotsDir, '04-maxi-family-media-suggestion.png'), fullPage: true });
  await page.getByTestId('sofia-featured-offer-2x1-hamburguesas').screenshot({ path: path.join(screenshotsDir, '05-2x1-offer.png') });
  await page.getByTestId('sofia-featured-offer-doble-todo').screenshot({ path: path.join(screenshotsDir, '06-doble-todo-offer.png') });
  await page.getByTestId('sofia-featured-offer-hamburguesa-sencilla').screenshot({ path: path.join(screenshotsDir, '07-sencilla-offer.png') });
  await page.getByTestId('sofia-agent-upsell').screenshot({ path: path.join(screenshotsDir, '08-upsell-papitas-adicionales.png') });

  await page.getByTestId('sofia-sandbox-message-type').selectOption('AUDIO_TRANSCRIPT');
  await page.getByTestId('sofia-sandbox-confidence').fill('0.6');
  await processMessage(page, 'dos hamburguesas 2x1 y una gaseosa');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('¿Es correcto?');
  await page.screenshot({ path: path.join(screenshotsDir, '06-audio-transcript-processing.png'), fullPage: true });

  await page.getByTestId('sofia-sandbox-message-type').selectOption('TEXT');
  await processMessage(page, 'soy Cliente Sandbox');
  await processMessage(page, 'mi direccion es Calle 9 # 12-34 barrio Centro');
  await expect(page.getByTestId('sofia-agent-missing-fields')).toContainText('Listo para confirmar', { timeout: 15000 });

  await processMessage(page, 'si confirmo');
  await expect(page.getByTestId('sofia-agent-confirmed-order')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('sofia-agent-confirmed-order')).toContainText('No creó OrderTicket');
  await expect(page.getByTestId('sofia-agent-payment-link')).toHaveCount(0);
  await expect(page.locator('a[href="/deliveries"]')).toHaveCount(0);
  await expect(page.locator('a[href="/pos"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotsDir, '08-sandbox-draft-confirmation.png'), fullPage: true });

  await processMessage(page, 'kiero una hamburgesa 2x1 con domisilio');
  await page.getByTestId('sofia-agent-recover-abandoned').click();
  await expect(page.getByTestId('sofia-agent-recovery-result')).toContainText('pendiente', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '11-abandoned-order-recovery.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await processMessage(page, 'quiero hablar con alguien');
  await expect(page.getByTestId('sofia-agent-handoff')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '12-handoff-human-required.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sofia-sandbox-phone').fill(`5730099${Date.now().toString().slice(-5)}`);
  await page.getByTestId('sofia-sandbox-customer').fill('Cliente No Inventar');
  await processMessage(page, 'quiero sushi galactico');
  await expect(page.getByTestId('sofia-agent-extracted-items')).toContainText('Sin productos detectados');
  await expect(page.getByTestId('sofia-agent-response')).toContainText('Déjame confirmarlo');
  await expect(page.locator('body')).not.toContainText(/\bundefined\b|\bNaN\b/);
  await page.screenshot({ path: path.join(screenshotsDir, '11-final-summary-go.png'), fullPage: true });
});
