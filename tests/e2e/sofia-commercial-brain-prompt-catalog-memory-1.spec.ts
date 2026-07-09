import { expect, test } from './fixtures/worker-auth';

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

async function processCommercialMessage(
  page: import('@playwright/test').Page,
  accessToken: string,
  payload: Record<string, unknown>,
) {
  const response = await page.request.post('/api/admin/sofia/sandbox/commercial-message', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      messageType: 'TEXT',
      sandboxNow: '2026-07-01T23:00:00.000Z',
      ...payload,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('Sofia commercial brain uses canonical prompt, catalog, memory and anti-invention rules', async ({
  page,
  workerAccessToken,
}) => {
  const promptResponse = await page.request.get('/api/admin/sofia/prompt/active', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(promptResponse.status()).toBe(200);
  const prompt = await promptResponse.json();
  expect(prompt.version).toBe('SOFIA_MASTER_PROMPT_V1');
  expect(prompt.status).toBe('ACTIVE');

  const catalogResponse = await page.request.get('/api/admin/sofia/catalog', {
    headers: { Authorization: `Bearer ${workerAccessToken}` },
  });
  expect(catalogResponse.status()).toBe(200);
  const catalog = await catalogResponse.json();
  const offers = catalog.filter((item: { type: string }) => item.type === 'OFFER');
  expect(offers.map((item: { slug: string }) => item.slug)).toEqual([
    'maxi-family',
    '2x1-hamburguesas',
    'doble-todo',
    'hamburguesa-sencilla',
  ]);

  const phone = `57317${Date.now().toString().slice(-7)}`;
  const maxi = await processCommercialMessage(page, workerAccessToken, {
    phone,
    customerName: 'Cliente E2E Comercial',
    message: 'qué trae el Maxi Family',
  });
  expect(maxi.promptVersion).toBe('SOFIA_MASTER_PROMPT_V1');
  expect(maxi.responseText).toContain('6 burgers');
  expect(maxi.responseText).toContain('porción personal de papitas');
  expect(maxi.responseText).toContain('Pepsi 1.5 L');
  expect(maxi.responseText).not.toMatch(/papas familiares|papas grandes|papas para todos|papitas para todos|porción familiar/i);
  expect(maxi.mediaSuggestion.imageUrl).toBe('/uploads/sofia-offers/maxi-family.webp');

  const doble = await processCommercialMessage(page, workerAccessToken, {
    phone: `${phone}1`,
    customerName: 'Cliente Doble E2E',
    message: 'y la doble todo qué trae',
  });
  expect(doble.responseText).toContain('doble carne');
  expect(doble.responseText).toContain('doble tocineta');
  expect(doble.responseText).toContain('doble queso cheddar en lonjas');

  const unknown = await processCommercialMessage(page, workerAccessToken, {
    phone: `${phone}2`,
    customerName: 'Cliente Anti Invención',
    message: 'quiero sushi galactico',
  });
  expect(unknown.currentItems).toHaveLength(0);
  expect(unknown.responseText).toContain('Déjame confirmarlo');

  const noMemory = await processCommercialMessage(page, workerAccessToken, {
    phone: `${phone}3`,
    customerName: 'Cliente Sin Memoria',
    message: 'quiero lo mismo de ayer',
  });
  expect(noMemory.responseText).toContain('Todavía no tengo un pedido anterior confirmado');

  const payment = await processCommercialMessage(page, workerAccessToken, {
    phone: `${phone}4`,
    customerName: 'Cliente Pago E2E',
    message: 'pago por nequi',
  });
  expect(payment.paymentLinkUrl).toBeNull();
  expect(payment.safeguards.aiCannotMarkPaid).toBe(true);
  expect(payment.aiProvider.mode).toBe('disabled');
});
