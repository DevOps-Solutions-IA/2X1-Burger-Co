import { expect, test } from './fixtures/worker-auth';

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

async function evaluateAutoSafe(
  page: import('@playwright/test').Page,
  accessToken: string,
  payload: Record<string, unknown>,
) {
  const response = await page.request.post('/api/admin/sofia/sandbox/auto-safe-evaluate', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: payload,
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('Sofia Auto Safe Engine evaluates sandbox decisions without QR, DeepSeek or real WhatsApp', async ({
  page,
  workerAccessToken,
}) => {
  const approved = await evaluateAutoSafe(page, workerAccessToken, {
    messageText: 'qué trae el Maxi Family',
    candidateReply:
      'El Maxi Family trae 6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L. Si quieres que todos acompañen con papitas, puedes agregar porciones adicionales.',
    autoSafeEnabled: true,
    sandbox: true,
  });
  expect(approved.decision.status).toBe('AUTO_SAFE_APPROVED');
  expect(approved.decision.approved).toBe(true);
  expect(approved.decision.shouldSend).toBe(false);
  expect(approved.reasonCodes).toContain('PASS_ALL_RULES');
  expect(approved.noWhatsappReal).toBe(true);

  const blockedMaxi = await evaluateAutoSafe(page, workerAccessToken, {
    messageText: 'viene con papas grandes',
    candidateReply: 'El Maxi Family trae 6 burgers, papas grandes y Pepsi 1.5 L.',
  });
  expect(blockedMaxi.decision.status).toBe('BLOCKED');
  expect(blockedMaxi.reasonCodes).toContain('MAXI_FAMILY_COPY_RISK');

  const paidClaim = await evaluateAutoSafe(page, workerAccessToken, {
    messageText: 'ya pagué por Nequi',
    candidateReply: 'Pago confirmado, ya quedó pagado.',
  });
  expect(paidClaim.decision.status).toBe('BLOCKED');
  expect(paidClaim.reasonCodes).toContain('PAID_CLAIM_BLOCKED');
  expect(paidClaim.finalReply).toBeNull();

  const complaint = await evaluateAutoSafe(page, workerAccessToken, {
    phone: `57318${Date.now().toString().slice(-7)}`,
    messageText: 'me llegó mal el pedido',
  });
  expect(complaint.decision.status).toBe('HUMAN_REQUIRED');
  expect(complaint.reasonCodes).toContain('CUSTOMER_COMPLAINT');

  const unknown = await evaluateAutoSafe(page, workerAccessToken, {
    phone: `57319${Date.now().toString().slice(-7)}`,
    messageText: 'quiero sushi galactico',
  });
  expect(unknown.decision.status).toBe('HUMAN_REQUIRED');
  expect(unknown.reasonCodes).toContain('UNKNOWN_PRODUCT');
  expect(unknown.finalReply).toContain('Déjame confirmarlo con el equipo');

  await page.goto('/sofia/sandbox', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia sandbox redirected to login').not.toHaveURL(/\/login/);
  await page.getByTestId('sofia-sandbox-phone').fill(`57320${Date.now().toString().slice(-7)}`);
  await page.getByTestId('sofia-sandbox-message').fill('qué trae el Maxi Family');
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/admin/sofia/sandbox/commercial-message') && response.status() === 201,
    ),
    page.getByTestId('sofia-sandbox-process').click(),
  ]);
  await expect(page.getByTestId('sofia-auto-safe-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sofia-auto-safe-status')).toContainText(/AUTO_SAFE_APPROVED|DRAFT_ONLY|HUMAN_REQUIRED|BLOCKED/);
  await expect(page.getByTestId('sofia-auto-safe-panel')).toContainText('No WhatsApp real enviado');
  await expect(page.getByTestId('sofia-auto-safe-reasons')).toBeVisible();
});
