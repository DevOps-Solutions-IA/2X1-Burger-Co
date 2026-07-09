import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = '/tmp/sofia-whatsapp-qr-gateway-4/screenshots';

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(140_000);

test('Sofia WhatsApp QR Gateway works in receive_only and blocks real send', async ({
  page,
  workerAccessToken,
}) => {
  const statusResponse = await page.request.get('/api/admin/sofia/whatsapp/qr/status', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(statusResponse.status()).toBe(200);
  const status = await statusResponse.json();
  expect(status.provider).toBe('qr_gateway');
  expect(status.mode).toBe('receive_only');
  expect(status.realSendingEnabled).toBe(false);
  expect(status.autoReplyEnabled).toBe(false);
  expect(status.deepSeekEnabled).toBe(false);
  expect(JSON.stringify(status)).not.toContain('sk-');
  expect(JSON.stringify(status)).not.toContain('DEEPSEEK_API_KEY');
  expect(JSON.stringify(status)).not.toContain('HERMES_API_TOKEN');

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('WhatsApp QR Gateway');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Receive-only');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Sending real: false');
  await expect(page.getByTestId('sofia-production-status')).toContainText('Producción: BLOCKED');
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-qr-card.png'), fullPage: true });

  await page.goto('/sofia/whatsapp-qr', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-qr-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-qr-receive-only-warning')).toContainText('F4 no habilita producción');
  await expect(page.getByTestId('sofia-qr-status-card')).toContainText('Provider: qr_gateway');
  await expect(page.getByTestId('sofia-qr-status-card')).toContainText('DeepSeek real: disabled');

  await page.getByTestId('sofia-qr-connect').click();
  await expect(page.getByTestId('sofia-qr-code-card')).toContainText('sofia-qr-receive-only', { timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '02-sofia-whatsapp-qr-management.png'), fullPage: true });

  const phone = `57300${Date.now().toString().slice(-7)}`;
  await page.getByTestId('sofia-qr-test-phone').fill(phone);
  await page.getByTestId('sofia-qr-test-text').fill('quiero un maxi family');
  await page.getByTestId('sofia-qr-test-inbound-submit').click();
  await expect(page.getByTestId('sofia-qr-last-inbound')).toContainText('receive_only', { timeout: 20_000 });
  await expect(page.getByTestId('sofia-qr-last-inbound')).toContainText('SUGGESTED');

  await page.getByTestId('sofia-qr-test-send-submit').click();
  await expect(page.getByTestId('sofia-qr-last-send')).toContainText('BLOCKED_REAL_SEND_DISABLED', { timeout: 20_000 });

  const duplicateId = `qr-e2e-duplicate-${Date.now()}`;
  const firstInbound = await page.request.post('/api/admin/sofia/whatsapp/qr/test-inbound', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      phone,
      text: 'quiero un maxi family',
      externalMessageId: duplicateId,
      messageType: 'TEXT',
    },
  });
  expect(firstInbound.status()).toBe(201);
  const duplicateInbound = await page.request.post('/api/admin/sofia/whatsapp/qr/test-inbound', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      phone,
      text: 'quiero un maxi family',
      externalMessageId: duplicateId,
      messageType: 'TEXT',
    },
  });
  expect(duplicateInbound.status()).toBe(201);
  const duplicateBody = await duplicateInbound.json();
  expect(duplicateBody.duplicate).toBe(true);
  expect(duplicateBody.processingStatus).toBe('DUPLICATE_IGNORED');

  const enterprise = await page.request.get('/api/admin/sofia/enterprise-status', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(enterprise.status()).toBe(200);
  const enterpriseBody = await enterprise.json();
  expect(enterpriseBody.whatsapp.provider).toBe('qr_gateway');
  expect(enterpriseBody.whatsapp.qrGatewayReady).toBe(true);
  expect(enterpriseBody.whatsapp.realSendingEnabled).toBe(false);
  expect(enterpriseBody.ai.deepSeekReady).toBe(false);
  expect(enterpriseBody.payments.whatsappCanMarkPaid).toBe(false);
  expect(enterpriseBody.productionReadiness.status).toBe('BLOCKED');

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText(phone, { timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toContainText('qr_gateway');
  await page.screenshot({ path: path.join(screenshotsDir, '03-sofia-conversations-qr-inbound.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '04-sofia-sandbox-still-separated.png'), fullPage: true });

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('sk-');
  expect(body).not.toContain('DEEPSEEK_API_KEY');
  expect(body).not.toContain('HERMES_API_TOKEN');
});
