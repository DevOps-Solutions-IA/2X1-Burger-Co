import { BoundedJsonResponseError, readBoundedJson } from './bounded-json-response';

describe('readBoundedJson', () => {
  it('parses a bounded streamed response', async () => {
    await expect(readBoundedJson(new Response(JSON.stringify({ status: 'ok' })), 128))
      .resolves.toEqual({ status: 'ok' });
  });

  it('cancels a streamed response as soon as the byte ceiling is exceeded', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":"'));
        controller.enqueue(new Uint8Array(64));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBoundedJson(new Response(body), 16)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
    } satisfies Partial<BoundedJsonResponseError>);
    expect(cancelled).toBe(true);
  });

  it('rejects invalid JSON without projecting provider bytes', async () => {
    await expect(readBoundedJson(new Response('not-json'), 128)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID_JSON',
    });
  });
});
