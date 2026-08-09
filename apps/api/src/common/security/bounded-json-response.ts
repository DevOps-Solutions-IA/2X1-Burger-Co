const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export class BoundedJsonResponseError extends Error {
  constructor(readonly code: 'PROVIDER_RESPONSE_TOO_LARGE' | 'PROVIDER_RESPONSE_INVALID_JSON') {
    super(code);
    this.name = 'BoundedJsonResponseError';
  }
}

export async function readBoundedJson<T>(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<T> {
  const declaredLength = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BoundedJsonResponseError('PROVIDER_RESPONSE_TOO_LARGE');
  }

  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new BoundedJsonResponseError('PROVIDER_RESPONSE_TOO_LARGE');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as T;
    }

    // Deterministic response doubles may not expose a body stream.
    if (typeof response.text === 'function') {
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        throw new BoundedJsonResponseError('PROVIDER_RESPONSE_TOO_LARGE');
      }
      return JSON.parse(body) as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof BoundedJsonResponseError) throw error;
    throw new BoundedJsonResponseError('PROVIDER_RESPONSE_INVALID_JSON');
  }
}
