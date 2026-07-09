import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = '/tmp/sofia-learning-metrics-hardening-6/screenshots';

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

test('Sofia F6 shows metrics, learning, privacy, alerts and hardening without production activation', async ({
  page,
  workerAccessToken,
}) => {
  const metrics = await page.request.get('/api/admin/sofia/metrics/summary', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(metrics.status()).toBe(200);
  const metricsBody = await metrics.json();
  expect(metricsBody.payments.whatsappCanMarkPaid).toBe(false);
  expect(metricsBody.system.logSanitizationStatus).toBe('PASS');
  expect(JSON.stringify(metricsBody)).not.toContain('DEEPSEEK_API_KEY');

  const retention = await page.request.post('/api/admin/sofia/retention/dry-run', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(retention.status()).toBe(201);
  const retentionBody = await retention.json();
  expect(retentionBody.dryRun).toBe(true);
  expect(retentionBody.willDeleteOperationalOrders).toBe(false);

  const backup = await page.request.post('/api/admin/sofia/backups/dry-run', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(backup.status()).toBe(201);
  const backupBody = await backup.json();
  expect(backupBody.noSecrets).toBe(true);
  expect(JSON.stringify(backupBody)).not.toContain('storage/whatsapp-sessions/sofia-main/');

  const alertCheck = await page.request.post('/api/admin/sofia/alerts/check', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(alertCheck.status()).toBe(201);
  const alertBody = await alertCheck.json();
  expect(alertBody.externalNotificationsSent).toBe(false);

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-metrics-overview')).toBeVisible();
  await expect(page.getByTestId('sofia-learning-insights')).toContainText('Learning controlado');
  await expect(page.getByTestId('sofia-privacy-card')).toContainText('Privacidad');
  await expect(page.getByTestId('sofia-retention-card')).toContainText('DRY_RUN_READY');
  await expect(page.getByTestId('sofia-alerts-card')).toContainText('Alertas');
  await expect(page.getByTestId('sofia-backups-hardening-card')).toContainText('Backups');
  await expect(page.getByTestId('sofia-production-status')).toContainText('Producción: BLOCKED');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Sending real: false');
  await expect(page.getByTestId('sofia-deepseek-card')).toContainText('DeepSeek real: desactivado');
  await expect(page.getByTestId('sofia-rule-no-paid')).toContainText('WhatsApp no marca PAID: NO');
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-metrics-alerts-privacy.png'), fullPage: true });

  const phone = `57321${Date.now().toString().slice(-7)}`;
  const inbound = await page.request.post('/api/admin/sofia/whatsapp/qr/test-inbound', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      phone,
      text: 'Quiero hablar con alguien',
      externalMessageId: `qr-f6-feedback-${Date.now()}`,
      messageType: 'TEXT',
    },
  });
  expect(inbound.status()).toBe(201);

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText(phone, { timeout: 20_000 });
  await expect(page.getByTestId('sofia-human-feedback-panel')).toBeVisible();
  await page.getByTestId('sofia-feedback-bad').click();
  await expect(page.getByText('Feedback humano registrado sin entrenamiento externo')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '02-sofia-conversations-feedback.png'), fullPage: true });

  await page.goto('/sofia/whatsapp-qr', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-qr-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-qr-status-card')).toContainText('DeepSeek real: disabled');
  await page.screenshot({ path: path.join(screenshotsDir, '03-sofia-whatsapp-qr-blocked.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '04-sofia-sandbox.png'), fullPage: true });

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('DEEPSEEK_API_KEY');
  expect(body).not.toContain('HERMES_API_TOKEN');
  expect(body).not.toContain('WHATSAPP_QR_SESSION_PATH');
});
