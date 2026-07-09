import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = '/tmp/sofia-enterprise-governance-panel-3/screenshots';

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

test('Sofia enterprise governance panel shows readiness, security and route separation', async ({
  page,
  workerAccessToken,
}) => {
  const statusResponse = await page.request.get('/api/admin/sofia/enterprise-status', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(statusResponse.status()).toBe(200);
  const status = await statusResponse.json();
  expect(status.overallStatus).toBe('BLOCKED_FOR_PRODUCTION');
  expect(status.productionReadiness.status).toBe('BLOCKED');
  expect(status.security.secretRotationStatus).toBe('PENDING');
  expect(status.security.canActivateQrReal).toBe(false);
  expect(status.security.canActivateDeepSeekReal).toBe(false);
  expect(status.security.canActivateAutoSafeProduction).toBe(false);
  expect(status.whatsapp.realSendingEnabled).toBe(false);
  expect(status.payments.whatsappCanMarkPaid).toBe(false);
  expect(JSON.stringify(status)).not.toContain('sk-');
  expect(JSON.stringify(status)).not.toContain('DEEPSEEK_API_KEY');
  expect(JSON.stringify(status)).not.toContain('HERMES_API_TOKEN');

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia governance redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-enterprise-header')).toContainText('Centro de Gobierno Sofía');
  await expect(page.getByTestId('sofia-sandbox-status')).toContainText('Sandbox: PASS');
  await expect(page.getByTestId('sofia-production-status')).toContainText('Producción: BLOCKED');
  await expect(page.getByTestId('sofia-production-blocker-banner')).toContainText('rotación externa de secretos');
  await expect(page.getByTestId('sofia-prompt-card')).toContainText('SOFIA_MASTER_PROMPT_V1');
  await expect(page.getByTestId('sofia-catalog-card')).toBeVisible();
  await expect(page.getByTestId('sofia-memory-card')).toBeVisible();
  await expect(page.getByTestId('sofia-auto-safe-card')).toBeVisible();
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('QR Gateway: arquitectura lista');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Sending real: false');
  await expect(page.getByTestId('sofia-deepseek-card')).toContainText('DeepSeek real: desactivado');
  await expect(page.getByTestId('sofia-operation-card')).toContainText('WhatsApp no marca PAID: NO');
  await expect(page.getByTestId('sofia-readiness-secret_rotation')).toContainText('BLOCKED');
  await expect(page.getByTestId('sofia-readiness-qr_gateway_real')).toContainText('BLOCKED');
  await expect(page.getByTestId('sofia-readiness-auto_safe_sandbox')).toContainText('PASS');
  await expect(page.getByTestId('sofia-kill-switch')).toBeVisible();
  await expect(page.getByTestId('sofia-access-sandbox')).toHaveAttribute('href', '/sofia/sandbox');
  await expect(page.getByTestId('sofia-access-conversations')).toHaveAttribute('href', '/sofia/conversations');
  await expect(page.getByTestId('sofia-access-deliveries')).toHaveAttribute('href', '/deliveries');
  await expect(page.getByTestId('sofia-access-pos')).toHaveAttribute('href', '/pos');

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('sk-');
  expect(body).not.toContain('DEEPSEEK_API_KEY');
  expect(body).not.toContain('HERMES_API_TOKEN');
  expect(body).not.toContain('HERMES_WEBHOOK_SECRET');
  for (const tid of ['sofia-technical-sandbox', 'sofia-conversation-phone', 'sofia-create-conversation', 'sofia-draft-customer', 'sofia-create-draft']) {
    await expect(page.getByTestId(tid)).toHaveCount(0);
  }
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-enterprise-governance-home.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '02-sofia-sandbox-separated.png'), fullPage: true });

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '03-sofia-conversations-separated.png'), fullPage: true });
});
