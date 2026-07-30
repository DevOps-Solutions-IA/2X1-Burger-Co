import { createHmac } from 'node:crypto';
import { BoldPaymentProvider } from './bold-payment.provider';

describe('BoldPaymentProvider', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BOLD_API_KEY: 'test-api-key',
      BOLD_WEBHOOK_SECRET: 'test-webhook-secret',
      BOLD_BASE_URL: 'https://integrations.api.bold.co',
      BOLD_TIMEOUT_MS: '1000',
      BOLD_PAYMENT_LINK_TTL_MINUTES: '20',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates a closed COP link with a sanitized idempotent reference', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          payload: {
            payment_link: 'LNK_TEST_123',
            url: 'https://checkout.bold.co/payment/LNK_TEST_123',
          },
          errors: [],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const result = await new BoldPaymentProvider().createPayment({
      orderReference: 'ORD-123 !!',
      amount: 29_000,
      currency: 'COP',
      customerName: null,
      customerPhone: null,
      description: 'Pedido Sofia ORD-123',
      metadata: {},
    });

    expect(result).toMatchObject({
      provider: 'BOLD',
      providerPaymentId: 'LNK_TEST_123',
      providerReference: 'ORD-123',
      status: 'PENDING',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://integrations.api.bold.co/online/link/v1');
    expect(request.headers).toMatchObject({
      Authorization: 'x-api-key test-api-key',
      'Idempotency-Key': 'ORD-123',
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: 29_000, tip_amount: 0 },
      reference: 'ORD-123',
    });
  });

  it('fails closed when Bold credentials are absent', async () => {
    delete process.env.BOLD_API_KEY;

    await expect(
      new BoldPaymentProvider().createPayment({
        orderReference: 'ORD-123',
        amount: 29_000,
        currency: 'COP',
        customerName: null,
        customerPhone: null,
        description: 'Pedido Sofia',
        metadata: {},
      }),
    ).rejects.toThrow('Bold no está configurado');
  });

  it('verifies the signature against the exact raw request body', () => {
    const rawBody = Buffer.from('{"type":"SALE_APPROVED","data":{"amount":{"total":29000}}}');
    const signature = createHmac('sha256', 'test-webhook-secret')
      .update(rawBody.toString('base64'))
      .digest('hex');
    const provider = new BoldPaymentProvider();

    expect(
      provider.verifyWebhookSignature({}, { 'x-bold-signature': signature }, rawBody),
    ).toBe(true);
    expect(
      provider.verifyWebhookSignature({}, { 'x-bold-signature': signature }, Buffer.from('{}')),
    ).toBe(false);
    expect(provider.verifyWebhookSignature({}, { 'x-bold-signature': signature })).toBe(false);
  });

  it('maps a signed sale event without retaining the full provider payload', () => {
    const parsed = new BoldPaymentProvider().parseWebhook({
      id: 'event-123',
      type: 'SALE_APPROVED',
      data: {
        payment_id: 'payment-123',
        reference: 'ORD-123',
        amount: { total: 29_000, currency: 'COP', taxes: [{ value: 1 }] },
        payer: { email: 'must-not-persist@example.invalid', phone: 'synthetic-number' },
      },
    });

    expect(parsed).toMatchObject({
      eventId: 'event-123',
      eventType: 'SALE_APPROVED',
      providerPaymentId: 'payment-123',
      providerReference: 'ORD-123',
      orderReference: 'ORD-123',
      status: 'APPROVED',
      amount: 29_000,
      currency: 'COP',
    });
    expect(JSON.stringify(parsed.rawPayload)).not.toContain('must-not-persist');
    expect(JSON.stringify(parsed.rawPayload)).not.toContain('synthetic-number');
  });
});
