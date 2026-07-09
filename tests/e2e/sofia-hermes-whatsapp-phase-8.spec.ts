import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-hermes-whatsapp-real-resilience-phase-8',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(240_000);

async function ensureCashOpen(page: import('@playwright/test').Page, accessToken: string) {
  const currentResponse = await page.request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);
  if (!currentCash) {
    const openResponse = await page.request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { openingAmount: 50000, notes: 'Apertura E2E WhatsApp/Hermes mock Sofía' },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function sendMockWhatsapp(
  page: import('@playwright/test').Page,
  mode: 'disabled' | 'mock' | 'receive_only' | 'supervised' | 'auto',
  payload: Record<string, unknown>,
) {
  const response = await page.request.post('/api/integrations/whatsapp/mock/webhook', {
    headers: {
      'x-sofia-whatsapp-mode': mode,
      'x-sofia-whatsapp-provider': 'mock',
    },
    data: {
      sandboxNow: '2026-07-01T23:00:00.000Z',
      ...payload,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('Sofia WhatsApp/Hermes mock modes handle deduplication, supervised approval, human pause, audio and operational order', async ({
  page,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);
  const runId = Date.now().toString().slice(-8);

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page, 'Sofía conversations redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-whatsapp-mode-status')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '01-whatsapp-mode-status.png'), fullPage: true });

  const inbound = await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-maxi-event`,
    providerMessageId: `e2e-${runId}-maxi-message`,
    phone: `57316${runId}`,
    customerName: 'Cliente WhatsApp E2E',
    body: 'quiero un maxi family',
  });
  expect(inbound.sofiaResult.responseText).toContain('porción personal de papitas');
  expect(inbound.sofiaResult.responseText).not.toContain('papas familiares');
  expect(inbound.outbound.status).toBe('SENT');

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText(`57316${runId}`, { timeout: 15000 });
  await page.getByTestId('sofia-whatsapp-conversations-list').getByRole('button').filter({ hasText: `57316${runId}` }).first().click();
  await expect(page.getByTestId('sofia-whatsapp-inbound-message').first()).toBeVisible();
  await expect(page.getByTestId('sofia-whatsapp-outbound-row').first()).toContainText('porción personal de papitas');
  await page.screenshot({ path: path.join(screenshotsDir, '02-whatsapp-conversations-list.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '03-inbound-mock-message.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '04-sofia-suggested-reply.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '06-outbound-sent-mock.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '11-maxi-family-whatsapp-copy.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '12-media-offer-suggestion.png'), fullPage: true });

  const duplicate = await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-maxi-event`,
    providerMessageId: `e2e-${runId}-maxi-message`,
    phone: `57316${runId}`,
    customerName: 'Cliente WhatsApp E2E',
    body: 'quiero un maxi family',
  });
  expect(duplicate.duplicate).toBe(true);
  expect(duplicate.processingStatus).toBe('DUPLICATE_IGNORED');
  await page.screenshot({ path: path.join(screenshotsDir, '07-duplicate-ignored.png'), fullPage: true });

  const supervised = await sendMockWhatsapp(page, 'supervised', {
    providerEventId: `e2e-${runId}-supervised-event`,
    providerMessageId: `e2e-${runId}-supervised-message`,
    phone: `57317${runId}`,
    customerName: 'Cliente Supervisado E2E',
    body: 'qué combos tienen',
  });
  expect(supervised.outbound.status).toBe('APPROVAL_PENDING');
  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-approval-pending').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '05-supervised-approval-pending.png'), fullPage: true });
  const approveResponse = await page.request.post(`/api/admin/sofia/outbound/${supervised.outbound.id}/approve-send`, {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(approveResponse.status()).toBe(201);

  const human = await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-human-event`,
    providerMessageId: `e2e-${runId}-human-message`,
    phone: `57318${runId}`,
    body: 'quiero hablar con alguien',
  });
  expect(human.sofiaResult.shouldHandoff).toBe(true);
  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText('HUMAN_REQUIRED', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '08-human-required.png'), fullPage: true });
  await page.request.post(`/api/admin/sofia/conversations/${human.conversationId}/pause`, {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText('SOFIA_PAUSED', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '09-sofia-paused.png'), fullPage: true });
  await page.request.post(`/api/admin/sofia/conversations/${human.conversationId}/resume`, {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText('Sofía activa', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '10-sofia-resumed.png'), fullPage: true });

  const audio = await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-audio-event`,
    providerMessageId: `e2e-${runId}-audio-message`,
    phone: `57319${runId}`,
    messageType: 'AUDIO',
    mediaUrl: 'mock://audio.ogg',
  });
  expect(audio.sofiaResult.responseText).toContain('confirmes el pedido por texto');
  expect(audio.sofiaResult.deliveryOrder).toBeNull();

  const orderPhone = `57320${runId}`;
  await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-order-item-event`,
    providerMessageId: `e2e-${runId}-order-item-message`,
    phone: orderPhone,
    body: 'quiero una hamburguesa 2x1 con domicilio',
  });
  await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-order-name-event`,
    providerMessageId: `e2e-${runId}-order-name-message`,
    phone: orderPhone,
    body: 'soy Cliente Hermes E2E',
  });
  await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-order-address-event`,
    providerMessageId: `e2e-${runId}-order-address-message`,
    phone: orderPhone,
    body: 'mi direccion es Calle 8 # 9-10 barrio Centro',
  });
  const confirmed = await sendMockWhatsapp(page, 'mock', {
    providerEventId: `e2e-${runId}-order-confirm-event`,
    providerMessageId: `e2e-${runId}-order-confirm-message`,
    phone: orderPhone,
    body: 'si confirmo',
  });
  expect(confirmed.sofiaResult.deliveryOrder.orderTicketId).toBeTruthy();
  expect(confirmed.sofiaResult.paymentLinkUrl).toContain('/pagos/');

  await page.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  const createdCard = page.getByTestId('deliveries-sofia-queue-item').filter({ hasText: 'Cliente Hermes E2E' }).first();
  await expect(createdCard).toBeVisible({ timeout: 20000 });
  await expect(createdCard.getByTestId('deliveries-sofia-order-chip')).toContainText('Sofía');
  await page.screenshot({ path: path.join(screenshotsDir, '13-order-created-deliveries-chip-sofia.png'), fullPage: true });
  await expect(createdCard).toContainText(/Pago sin seleccionar|UNSELECTED/i);
  await page.screenshot({ path: path.join(screenshotsDir, '14-payment-link-generated.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '15-final-summary.png'), fullPage: true });
});
