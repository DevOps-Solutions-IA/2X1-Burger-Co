import type { ConfigService } from '@nestjs/config';
import { HermesWhatsappProvider } from './hermes-whatsapp.provider';

describe('HermesWhatsappProvider outbound identity', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function provider(timeoutMs = '50') {
    return new HermesWhatsappProvider({
      get: (key: string) => ({
        HERMES_BASE_URL: 'https://hermes.example',
        HERMES_API_TOKEN: 'test-token',
        HERMES_TIMEOUT_MS: timeoutMs,
      })[key],
    } as unknown as ConfigService);
  }

  function response(body: Record<string, unknown>, ok = true, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as typeof fetch;
  }

  const input = { to: '573001234567', body: 'Mensaje gobernado', idempotencyKey: 'command-1' };

  it('accepts a bounded opaque provider message identity', async () => {
    response({ id: 'hermes_msg-01:accepted' });

    await expect(provider().sendTextMessage(input)).resolves.toMatchObject({
      status: 'SENT',
      providerMessageId: 'hermes_msg-01:accepted',
    });
  });

  it.each([
    ['missing', {}],
    ['numeric', { id: 12345 }],
    ['object', { id: { value: 'message-1' } }],
    ['blank', { id: '   ' }],
    ['control characters', { id: 'message-1\nforged' }],
    ['oversized', { id: 'a'.repeat(257) }],
  ])('treats a 2xx response with %s identity as an unknown result', async (_case, body) => {
    response(body);

    await expect(provider().sendTextMessage(input)).rejects.toThrow('HERMES_PROVIDER_MESSAGE_ID_INVALID');
  });

  it('does not convert an aborted provider request into a sent result', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;

    const pending = provider('10').sendTextMessage(input);
    const rejection = expect(pending).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(11);

    await rejection;
  });
});
