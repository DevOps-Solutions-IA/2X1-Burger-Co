import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = '/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots';

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

test('Sofia QR receive_only physical pilot stays controlled with simulated inbound and blocked send', async ({
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
  expect(JSON.stringify(status)).not.toContain('WHATSAPP_QR_SESSION_PATH');

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('WhatsApp QR Gateway');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Receive-only');
  await expect(page.getByTestId('sofia-whatsapp-qr-card')).toContainText('Sending real: false');
  await expect(page.getByTestId('sofia-production-status')).toContainText('Producción: BLOCKED');
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-qr-status.png'), fullPage: true });

  await page.goto('/sofia/whatsapp-qr', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-qr-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-qr-receive-only-warning')).toContainText('Envío real');
  await expect(page.getByTestId('sofia-qr-receive-only-warning')).toContainText('permanecen bloqueados');
  await page.getByTestId('sofia-qr-connect').click();
  await expect(page.getByTestId('sofia-qr-code-card')).toContainText('sofia-qr-receive-only', { timeout: 20_000 });

  const phone = `57320${Date.now().toString().slice(-7)}`;
  const messages = [
    'Hola',
    'Qué trae el Maxi Family',
    'Quiero un 2x1',
    'Ya pagué por Nequi',
    'Quiero hablar con alguien',
    'Quiero sushi',
  ];
  for (const [index, text] of messages.entries()) {
    const response = await page.request.post('/api/admin/sofia/whatsapp/qr/test-inbound', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: {
        phone,
        text,
        externalMessageId: `qr-f5-e2e-${Date.now()}-${index}`,
        messageType: 'TEXT',
      },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.provider).toBe('qr_gateway');
    expect(body.mode).toBe('receive_only');
    expect(JSON.stringify(body)).not.toContain('"status":"SENT"');
    expect(JSON.stringify(body)).not.toContain('"sent":true');
  }

  await page.screenshot({ path: path.join(screenshotsDir, '02-sofia-whatsapp-qr-management.png'), fullPage: true });

  const eventsResponse = await page.request.get('/api/admin/sofia/whatsapp/qr/inbound-events?limit=20', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(eventsResponse.status()).toBe(200);
  const events = await eventsResponse.json();
  expect(events.provider).toBe('qr_gateway');
  expect(events.realSendingEnabled).toBe(false);
  expect(Array.isArray(events.events)).toBe(true);
  expect(JSON.stringify(events)).not.toContain(phone);
  expect(JSON.stringify(events)).not.toContain('/home/');
  expect(JSON.stringify(events)).not.toContain('sk-');

  const blockedSend = await page.request.post('/api/admin/sofia/whatsapp/qr/test-send', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: { phone, text: 'prueba bloqueo envio real' },
  });
  expect(blockedSend.status()).toBe(201);
  const blockedSendBody = await blockedSend.json();
  expect(blockedSendBody.status).toBe('BLOCKED_REAL_SEND_DISABLED');
  expect(blockedSendBody.sent).toBe(false);
  expect(blockedSendBody.realSendingEnabled).toBe(false);

  const enterprise = await page.request.get('/api/admin/sofia/enterprise-status', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(enterprise.status()).toBe(200);
  const enterpriseBody = await enterprise.json();
  expect(enterpriseBody.productionReadiness.status).toBe('BLOCKED');
  expect(enterpriseBody.whatsapp.provider).toBe('qr_gateway');
  expect(enterpriseBody.whatsapp.realSendingEnabled).toBe(false);
  expect(enterpriseBody.ai.deepSeekReady).toBe(false);
  expect(enterpriseBody.payments.whatsappCanMarkPaid).toBe(false);

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText(phone, { timeout: 20_000 });
  await expect(page.getByTestId('sofia-whatsapp-conversations-page')).toContainText('qr_gateway');
  await page.screenshot({ path: path.join(screenshotsDir, '03-sofia-conversations-inbound.png'), fullPage: true });

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-sandbox-agent')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshotsDir, '04-sofia-sandbox.png'), fullPage: true });

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toContain('DEEPSEEK_API_KEY');
  expect(visibleText).not.toContain('HERMES_API_TOKEN');
  expect(visibleText).not.toContain('WHATSAPP_QR_SESSION_PATH');
});
