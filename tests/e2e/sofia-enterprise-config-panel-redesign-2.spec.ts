import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/deepseek-sofia-enterprise-config-panel-redesign-2',
);

test.beforeAll(() => { mkdirSync(screenshotsDir, { recursive: true }); });
test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

async function goToSofia(page: import('@playwright/test').Page) {
  await page.goto('/sofia');
  await page.waitForSelector('[data-testid="sofia-admin-page"]', { timeout: 15_000 });
}

/* ------------------------------------------------------------------ */
/*  01. Page loads                                                     */
/* ------------------------------------------------------------------ */
test('01 - /sofia loads enterprise header', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-enterprise-header')).toBeVisible();
  await expect(page.getByTestId('sofia-enterprise-header')).toContainText('Centro de gobierno');
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-enterprise-status-header.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  02. WhatsApp / Hermes health                                       */
/* ------------------------------------------------------------------ */
test('02 - WhatsApp health card visible with webhook status', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-whatsapp-health')).toBeVisible();
  await expect(page.getByTestId('sofia-whatsapp-health')).toContainText('WhatsApp / Hermes');
  await expect(page.getByTestId('sofia-whatsapp-health')).toContainText('Webhook');
  await page.screenshot({ path: path.join(screenshotsDir, '02-whatsapp-hermes-health.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  03. Deduplication                                                  */
/* ------------------------------------------------------------------ */
test('03 - Deduplication card visible with TTL', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-deduplication')).toBeVisible();
  await expect(page.getByTestId('sofia-deduplication')).toContainText('Deduplicación');
  await expect(page.getByTestId('sofia-deduplication')).toContainText('TTL');
  await page.screenshot({ path: path.join(screenshotsDir, '03-deduplication-card.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  04. Outbox global                                                  */
/* ------------------------------------------------------------------ */
test('04 - Outbox global shows pending, queued, sent', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-outbox-global')).toBeVisible();
  await expect(page.getByTestId('sofia-outbox-global')).toContainText('Outbox global');
  await page.screenshot({ path: path.join(screenshotsDir, '04-outbox-global-card.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  05. Handoff global                                                 */
/* ------------------------------------------------------------------ */
test('05 - Handoff card visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-handoff-global')).toBeVisible();
  await expect(page.getByTestId('sofia-handoff-global')).toContainText('Handoff');
  await page.screenshot({ path: path.join(screenshotsDir, '05-handoff-global-card.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  06. SafetyGuard protections                                        */
/* ------------------------------------------------------------------ */
test('06 - SafetyGuard protections visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-safetyguard-card')).toBeVisible();
  await expect(page.getByTestId('sofia-safetyguard-card')).toContainText('SafetyGuard');
  await expect(page.getByTestId('sofia-safetyguard-card')).toContainText('No marcar pagos como PAID');
  await expect(page.getByTestId('sofia-safetyguard-card')).toContainText('Secrets backend-only');
  await page.screenshot({ path: path.join(screenshotsDir, '06-safetyguard-protections.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  07. Production readiness                                           */
/* ------------------------------------------------------------------ */
test('07 - Production readiness checklist visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-produccion-readiness')).toBeVisible();
  await expect(page.getByTestId('sofia-produccion-readiness')).toContainText('Preparación para producción');
  await expect(page.getByTestId('sofia-produccion-readiness')).toContainText('WhatsApp');
  await page.screenshot({ path: path.join(screenshotsDir, '07-production-readiness-checklist.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  08. Kill-switch                                                    */
/* ------------------------------------------------------------------ */
test('08 - Kill-switch card visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-kill-switch')).toBeVisible();
  await expect(page.getByTestId('sofia-kill-switch')).toContainText('Kill-switch');
  await page.screenshot({ path: path.join(screenshotsDir, '08-kill-switch-global-if-available.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  09. WhatsApp no marca PAID                                         */
/* ------------------------------------------------------------------ */
test('09 - WhatsApp no marca PAID visible', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-rule-no-paid')).toBeVisible();
  await expect(page.getByTestId('sofia-rule-no-paid')).toContainText('WhatsApp nunca marca pagos como PAID');
});

/* ------------------------------------------------------------------ */
/*  10. Maxi Family correcto + forbidden                               */
/* ------------------------------------------------------------------ */
test('10 - Maxi Family shows correct copy, forbidden phrases listed', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-maxi-family-rule')).toContainText('6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L');
  const forbidden = page.getByTestId('sofia-forbidden-claim');
  expect(await forbidden.count()).toBeGreaterThanOrEqual(3);
  const texts = (await forbidden.allTextContents()).join(' ').toLowerCase();
  expect(texts).toContain('papas grandes');
  expect(texts).toContain('papas familiares');
  expect(texts).toContain('papas para todos');
});

/* ------------------------------------------------------------------ */
/*  11. No secrets in frontend                                         */
/* ------------------------------------------------------------------ */
test('11 - No secrets or API keys exposed in frontend', async ({ page }) => {
  await goToSofia(page);
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('DEEPSEEK_API_KEY');
  expect(body).not.toContain('HERMES_API_TOKEN');
  expect(body).not.toContain('HERMES_WEBHOOK_SECRET');
  expect(body).not.toContain('sk-');
  await page.screenshot({ path: path.join(screenshotsDir, '09-no-secrets-visible.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  12. No mocks/drafts on home                                        */
/* ------------------------------------------------------------------ */
test('12 - Home has zero mock forms or draft elements', async ({ page }) => {
  await goToSofia(page);
  for (const tid of ['sofia-technical-sandbox', 'sofia-conversation-phone', 'sofia-create-conversation', 'sofia-draft-customer', 'sofia-create-draft', 'sofia-drafts-list', 'sofia-confirm-draft']) {
    await expect(page.getByTestId(tid)).toHaveCount(0);
  }
});

/* ------------------------------------------------------------------ */
/*  13. Links work                                                     */
/* ------------------------------------------------------------------ */
test('13 - All access links point to correct routes', async ({ page }) => {
  await goToSofia(page);
  await expect(page.getByTestId('sofia-access-deliveries')).toHaveAttribute('href', '/deliveries');
  await expect(page.getByTestId('sofia-access-pos')).toHaveAttribute('href', '/pos');
  await expect(page.getByTestId('sofia-access-conversations')).toHaveAttribute('href', '/sofia/conversations');
  await expect(page.getByTestId('sofia-access-sandbox')).toHaveAttribute('href', '/sofia/sandbox');
});

/* ------------------------------------------------------------------ */
/*  14. Sandbox still works                                            */
/* ------------------------------------------------------------------ */
test('14 - /sofia/sandbox still loads', async ({ page }) => {
  await page.goto('/sofia/sandbox');
  await page.waitForSelector('[data-testid="sofia-sandbox-agent"]', { timeout: 15_000 });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '11-sandbox-still-works.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  15. Conversations still works                                      */
/* ------------------------------------------------------------------ */
test('15 - /sofia/conversations still loads', async ({ page }) => {
  await page.goto('/sofia/conversations');
  await page.waitForSelector('[data-testid="sofia-whatsapp-conversations-page"]', { timeout: 15_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '12-conversations-still-works.png'), fullPage: true });
});

/* ------------------------------------------------------------------ */
/*  16. Mobile layout                                                  */
/* ------------------------------------------------------------------ */
test('16 - Mobile viewport does not break', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goToSofia(page);
  await expect(page.getByTestId('sofia-enterprise-header')).toBeVisible();
  await expect(page.getByTestId('sofia-access-deliveries')).toBeVisible();
  await expect(page.getByTestId('sofia-produccion-readiness')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '10-mobile-layout.png'), fullPage: true });
});
