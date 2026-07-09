import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/deepseek-sofia-enterprise-config-panel-redesign-1',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

async function goToSofia(page: import('@playwright/test').Page) {
  await page.goto('/sofia');
  await page.waitForSelector('[data-testid="sofia-admin-page"]', { timeout: 15_000 });
}

/* ------------------------------------------------------------------ */
/*  01. Page loads — header                                           */
/* ------------------------------------------------------------------ */

test('01 - /sofia loads with enterprise header', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-enterprise-header')).toBeVisible();
  await expect(page.getByTestId('sofia-enterprise-header')).toContainText('Centro de gobierno');
  await expect(page.getByTestId('sofia-enterprise-header')).toContainText('Sofía');
  await page.screenshot({
    path: path.join(screenshotsDir, '01-sofia-home-enterprise-header.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  02. Principio operativo                                           */
/* ------------------------------------------------------------------ */

test('02 - Principio operativo visible with PAID rule', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-principio-operativo')).toBeVisible();
  await expect(page.getByTestId('sofia-principio-operativo')).toContainText('Sofía crea pedidos');
  await expect(page.getByTestId('sofia-principio-operativo')).toContainText(
    'WhatsApp nunca marca pagos como PAID',
  );
  await page.screenshot({
    path: path.join(screenshotsDir, '02-sofia-principio-operativo.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  03. Accesos operativos                                            */
/* ------------------------------------------------------------------ */

test('03 - Accesos operativos grid visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-accesos-operativos')).toBeVisible();
  await expect(page.getByTestId('sofia-access-deliveries')).toBeVisible();
  await expect(page.getByTestId('sofia-access-pos')).toBeVisible();
  await expect(page.getByTestId('sofia-access-conversations')).toBeVisible();
  await expect(page.getByTestId('sofia-access-sandbox')).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotsDir, '03-sofia-accesos-operativos.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  04. Links                                                         */
/* ------------------------------------------------------------------ */

test('04 - Access links point to correct routes', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-access-deliveries')).toHaveAttribute('href', '/deliveries');
  await expect(page.getByTestId('sofia-access-pos')).toHaveAttribute('href', '/pos');
  await expect(page.getByTestId('sofia-access-conversations')).toHaveAttribute(
    'href',
    '/sofia/conversations',
  );
  await expect(page.getByTestId('sofia-access-sandbox')).toHaveAttribute('href', '/sofia/sandbox');
});

/* ------------------------------------------------------------------ */
/*  05. System status shows all subsistemas                           */
/* ------------------------------------------------------------------ */

test('05 - System status shows WhatsApp, AI, SafetyGuard, POS, Pagos', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-system-status')).toBeVisible();
  await expect(page.getByTestId('sofia-system-status')).toContainText('WhatsApp / Hermes');
  await expect(page.getByTestId('sofia-system-status')).toContainText('DeepSeek');
  await expect(page.getByTestId('sofia-system-status')).toContainText('SafetyGuard');
  await expect(page.getByTestId('sofia-system-status')).toContainText('POS / Domicilios');
  await expect(page.getByTestId('sofia-system-status')).toContainText('Pagos online');
  await page.screenshot({
    path: path.join(screenshotsDir, '04-sofia-system-status.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  06. Maxi Family rule + forbidden phrases                          */
/* ------------------------------------------------------------------ */

test('06 - Reglas shows Maxi Family with correct copy and forbidden phrases', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-reglas-comerciales')).toBeVisible();
  await expect(page.getByTestId('sofia-maxi-family-rule')).toBeVisible();
  await expect(page.getByTestId('sofia-maxi-family-rule')).toContainText(
    '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
  );

  // forbidden claims are listed
  const forbidden = page.getByTestId('sofia-forbidden-claim');
  const count = await forbidden.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const texts = (await forbidden.allTextContents()).join(' ').toLowerCase();
  expect(texts).toContain('papas grandes');
  expect(texts).toContain('papas familiares');
  expect(texts).toContain('papas para todos');

  await page.screenshot({
    path: path.join(screenshotsDir, '05-sofia-reglas-comerciales.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  07. WhatsApp no marca PAID                                        */
/* ------------------------------------------------------------------ */

test('07 - WhatsApp no marca PAID rule visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-rule-no-paid')).toBeVisible();
  await expect(page.getByTestId('sofia-rule-no-paid')).toContainText(
    'WhatsApp nunca marca pagos como PAID',
  );
});

/* ------------------------------------------------------------------ */
/*  08. No mocks / drafts / fake clients                              */
/* ------------------------------------------------------------------ */

test('08 - Home has zero mock forms, drafts, or fake clients', async ({ page }) => {
  await goToSofia(page);

  for (const tid of [
    'sofia-technical-sandbox',
    'sofia-conversation-phone',
    'sofia-conversation-customer',
    'sofia-conversation-body',
    'sofia-create-conversation',
    'sofia-draft-customer',
    'sofia-draft-phone',
    'sofia-draft-address',
    'sofia-draft-quantity',
    'sofia-create-draft',
    'sofia-drafts-list',
    'sofia-draft-detail',
    'sofia-confirm-draft',
    'sofia-product-select',
    'sofia-conversation-select',
    'ai-sandbox-test',
  ]) {
    await expect(page.getByTestId(tid)).toHaveCount(0);
  }

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Cliente Mock');
  expect(body).not.toContain('Cliente Sandbox');
  expect(body).not.toContain('Cliente IA Sandbox');
});

/* ------------------------------------------------------------------ */
/*  09. Ofertas visibles                                              */
/* ------------------------------------------------------------------ */

test('09 - Four featured offers visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-offer-maxi-family')).toBeVisible();
  await expect(page.getByTestId('sofia-offer-2x1-hamburguesas')).toBeVisible();
  await expect(page.getByTestId('sofia-offer-doble-todo')).toBeVisible();
  await expect(page.getByTestId('sofia-offer-hamburguesa-sencilla')).toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  10. Producción readiness strip                                    */
/* ------------------------------------------------------------------ */

test('10 - Producción readiness strip shows subsystems', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-produccion-readiness')).toBeVisible();
  await expect(page.getByTestId('sofia-produccion-readiness')).toContainText('Hermes');
  await expect(page.getByTestId('sofia-produccion-readiness')).toContainText('SafetyGuard');
  await expect(page.getByTestId('sofia-produccion-readiness')).toContainText('Deduplicación');

  await page.screenshot({
    path: path.join(screenshotsDir, '06-sofia-produccion-readiness.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  11. Sandbox still works                                           */
/* ------------------------------------------------------------------ */

test('11 - /sofia/sandbox still loads', async ({ page }) => {
  await page.goto('/sofia/sandbox');
  await page.waitForSelector('[data-testid="sofia-sandbox-agent"]', { timeout: 15_000 });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible();
  await expect(page.getByTestId('sofia-sandbox-agent')).toContainText('Sandbox técnico');
  await page.screenshot({
    path: path.join(screenshotsDir, '07-sofia-sandbox-still-works.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  12. Conversations still works                                     */
/* ------------------------------------------------------------------ */

test('12 - /sofia/conversations still loads', async ({ page }) => {
  await page.goto('/sofia/conversations');
  await page.waitForSelector('[data-testid="sofia-whatsapp-conversations-page"]', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotsDir, '08-sofia-conversations-still-works.png'),
    fullPage: true,
  });
});

/* ------------------------------------------------------------------ */
/*  13. Mobile layout                                                 */
/* ------------------------------------------------------------------ */

test('13 - Mobile viewport does not break layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goToSofia(page);

  await expect(page.getByTestId('sofia-enterprise-header')).toBeVisible();
  await expect(page.getByTestId('sofia-access-deliveries')).toBeVisible();
  await expect(page.getByTestId('sofia-access-pos')).toBeVisible();
  await expect(page.getByTestId('sofia-access-conversations')).toBeVisible();
  await expect(page.getByTestId('sofia-access-sandbox')).toBeVisible();
  await expect(page.getByTestId('sofia-principio-operativo')).toBeVisible();
  await expect(page.getByTestId('sofia-reglas-comerciales')).toBeVisible();

  await page.screenshot({
    path: path.join(screenshotsDir, '09-sofia-mobile.png'),
    fullPage: true,
  });
});
