import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-deepseek-ai-provider-phase-8-5',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(180_000);

test('Sofia DeepSeek AI provider stays backend-only, guarded and compatible with WhatsApp mock', async ({
  page,
  workerAccessToken,
}) => {
  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-ai-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sofia-ai-card')).toContainText(/Provider: rules|Provider: deepseek|Provider: hybrid/);
  await expect(page.getByTestId('sofia-seguridad-card')).toContainText('API key no visible');
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-ai-provider-config.png'), fullPage: true });
  await page.getByTestId('sofia-ai-card').screenshot({ path: path.join(screenshotsDir, '02-deepseek-disabled-safe-default.png') });

  const healthCheck = await page.request.post('/api/admin/sofia/ai/health-check', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(healthCheck.status()).toBe(201);
  await page.screenshot({ path: path.join(screenshotsDir, '03-deepseek-health-check.png'), fullPage: true });

  const validAi = await page.request.post('/api/admin/sofia/ai/test', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      provider: 'deepseek',
      mode: 'suggest',
      scenario: 'valid',
      message: 'quiero un maxi family',
      phone: `57344${Date.now().toString().slice(-8)}`,
      customerName: 'Cliente IA E2E',
    },
  });
  expect(validAi.status()).toBe(201);
  const validAiBody = await validAi.json();
  expect(validAiBody.aiProvider.provider).toBe('deepseek');
  expect(validAiBody.responseText).toContain('porción personal de papitas');
  await page.screenshot({ path: path.join(screenshotsDir, '04-ai-sandbox-test.png'), fullPage: true });
  await page.getByTestId('sofia-ai-card').screenshot({ path: path.join(screenshotsDir, '05-ai-suggested-response.png') });
  await page.getByTestId('sofia-maxi-family-rule').screenshot({ path: path.join(screenshotsDir, '07-safetyguard-maxi-family.png') });

  const blockedAi = await page.request.post('/api/admin/sofia/ai/test', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      provider: 'deepseek',
      mode: 'suggest',
      scenario: 'invented_product',
      message: 'quiero sushi galactico',
      phone: `57346${Date.now().toString().slice(-8)}`,
    },
  });
  expect(blockedAi.status()).toBe(201);
  const blockedAiBody = await blockedAi.json();
  expect(blockedAiBody.aiProvider.safetyFlags).toContain('AI_SAFETY_BLOCKED_PRODUCT');
  expect(blockedAiBody.responseText).toContain('Déjame confirmarlo');
  await page.screenshot({ path: path.join(screenshotsDir, '06-safetyguard-product-block.png'), fullPage: true });

  const fallbackAi = await page.request.post('/api/admin/sofia/ai/test', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
    data: {
      provider: 'deepseek',
      mode: 'suggest',
      scenario: 'timeout',
      message: 'quiero un maxi family',
      phone: `57347${Date.now().toString().slice(-8)}`,
    },
  });
  expect(fallbackAi.status()).toBe(201);
  const fallbackAiBody = await fallbackAi.json();
  expect(fallbackAiBody.aiProvider.fallbackUsed).toBe(true);
  await page.screenshot({ path: path.join(screenshotsDir, '08-ai-fallback-rules.png'), fullPage: true });

  const runId = Date.now().toString().slice(-8);
  const whatsapp = await page.request.post('/api/integrations/whatsapp/mock/webhook', {
    headers: {
      Authorization: `Bearer ${workerAccessToken}`,
      'x-sofia-whatsapp-mode': 'supervised',
      'x-sofia-whatsapp-provider': 'mock',
      'x-sofia-ai-provider': 'deepseek',
      'x-sofia-ai-mode': 'suggest',
      'x-sofia-ai-mock-scenario': 'valid',
    },
    data: {
      providerEventId: `phase85-e2e-ai-${runId}`,
      providerMessageId: `phase85-e2e-ai-msg-${runId}`,
      phone: `57345${runId}`,
      body: 'quiero un maxi family',
      sandboxNow: '2026-07-01T23:00:00.000Z',
    },
  });
  expect(whatsapp.status()).toBe(201);
  const whatsappBody = await whatsapp.json();
  expect(whatsappBody.sofiaResult.aiProvider.provider).toBe('deepseek');
  expect(whatsappBody.outbound.status).toBe('APPROVAL_PENDING');
  expect(whatsappBody.outbound.body).toContain('porción personal de papitas');

  await page.goto('/sofia/conversations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-whatsapp-conversations-list')).toContainText(`57345${runId}`, { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '09-whatsapp-mock-with-ai.png'), fullPage: true });

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-seguridad-card')).toContainText('API key no visible');
  await expect(page.locator('body')).not.toContainText(/sk-|DEEPSEEK_API_KEY|HERMES_API_TOKEN|HERMES_WEBHOOK_SECRET/);
  await page.screenshot({ path: path.join(screenshotsDir, '10-no-secrets-visible.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '11-final-summary.png'), fullPage: true });
});
