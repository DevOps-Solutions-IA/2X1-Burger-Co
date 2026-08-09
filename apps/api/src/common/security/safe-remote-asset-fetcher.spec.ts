import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import {
  SafeRemoteAssetFetcher,
  type RemoteAssetRequest,
  type RemoteAssetResolver,
} from './safe-remote-asset-fetcher';

const PUBLIC_IPV4 = '93.184.216.34';
const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('bounded-image'),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);

type ResponseStep = Readonly<{
  body?: Buffer;
  headers?: Record<string, string>;
  statusCode: number;
}>;

describe('SafeRemoteAssetFetcher', () => {
  it('accepts a bounded PNG and pins the HTTPS request to the validated address', async () => {
    const captured: RequestOptions[] = [];
    const fetcher = createFetcher(
      [{ statusCode: 200, headers: { 'content-type': 'image/png' }, body: PNG }],
      undefined,
      captured,
    );

    const image = await fetcher.fetchImage('https://assets.example.com/logo.png');

    expect(image).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      hostname: 'assets.example.com',
      method: 'GET',
      path: '/logo.png',
      port: 443,
      protocol: 'https:',
      servername: 'assets.example.com',
    });
    expect(captured[0]!.lookup).toEqual(expect.any(Function));
  });

  it.each([
    ['plain HTTP', 'http://assets.example.com/logo.png', 'REMOTE_ASSET_HTTPS_REQUIRED'],
    ['URL credentials', 'https://user:secret@assets.example.com/logo.png', 'REMOTE_ASSET_CREDENTIALS_FORBIDDEN'],
    ['custom port', 'https://assets.example.com:8443/logo.png', 'REMOTE_ASSET_PORT_FORBIDDEN'],
    ['localhost', 'https://localhost/logo.png', 'REMOTE_ASSET_HOST_FORBIDDEN'],
  ])('rejects %s before opening a request', async (_label, url, code) => {
    const captured: RequestOptions[] = [];
    const fetcher = createFetcher([], undefined, captured);

    await expect(fetcher.fetchImage(url)).rejects.toMatchObject({ code });
    expect(captured).toHaveLength(0);
  });

  it.each([
    ['loopback IPv4', '127.0.0.1'],
    ['private IPv4', '10.20.30.40'],
    ['link-local IPv4', '169.254.169.254'],
    ['loopback IPv6', '::1'],
    ['unique-local IPv6', 'fd00::1'],
    ['IPv4-compatible private address', '::127.0.0.1'],
    ['mapped private IPv4', '::ffff:10.0.0.1'],
  ])('rejects a %s DNS result', async (_label, address) => {
    const resolver: RemoteAssetResolver = async () => [{
      address,
      family: address.includes(':') ? 6 : 4,
    }];
    const fetcher = createFetcher([], resolver);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_ADDRESS_FORBIDDEN',
    });
  });

  it('rejects the complete DNS answer when any address is private', async () => {
    const resolver: RemoteAssetResolver = async () => [
      { address: PUBLIC_IPV4, family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    const captured: RequestOptions[] = [];
    const fetcher = createFetcher([], resolver, captured);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_ADDRESS_FORBIDDEN',
    });
    expect(captured).toHaveLength(0);
  });

  it('revalidates DNS and policy after a bounded redirect', async () => {
    const resolvedHosts: string[] = [];
    const resolver: RemoteAssetResolver = async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: PUBLIC_IPV4, family: 4 }];
    };
    const fetcher = createFetcher([
      {
        statusCode: 302,
        headers: { location: 'https://cdn.example.com/final.jpg' },
      },
      {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg; charset=binary' },
        body: JPEG,
      },
    ], resolver);

    await expect(fetcher.fetchImage('https://assets.example.com/logo')).resolves.toEqual({
      bytes: JPEG,
      contentType: 'image/jpeg',
    });
    expect(resolvedHosts).toEqual(['assets.example.com', 'cdn.example.com']);
  });

  it('blocks a redirect to a private address before making the redirected request', async () => {
    const captured: RequestOptions[] = [];
    const fetcher = createFetcher([
      { statusCode: 302, headers: { location: 'https://127.0.0.1/internal.png' } },
    ], undefined, captured);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_ADDRESS_FORBIDDEN',
    });
    expect(captured).toHaveLength(1);
  });

  it('blocks an HTTPS to HTTP redirect before making the redirected request', async () => {
    const captured: RequestOptions[] = [];
    const fetcher = createFetcher([
      { statusCode: 302, headers: { location: 'http://assets.example.com/logo.png' } },
    ], undefined, captured);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_HTTPS_REQUIRED',
    });
    expect(captured).toHaveLength(1);
  });

  it('enforces the redirect bound', async () => {
    const fetcher = createFetcher([
      { statusCode: 302, headers: { location: 'https://one.example.com/logo.png' } },
      { statusCode: 302, headers: { location: 'https://two.example.com/logo.png' } },
      { statusCode: 302, headers: { location: 'https://three.example.com/logo.png' } },
    ]);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_REDIRECT_LIMIT',
    });
  });

  it('rejects a declared oversized response without buffering its body', async () => {
    const fetcher = createFetcher([
      {
        statusCode: 200,
        headers: { 'content-length': '65', 'content-type': 'image/png' },
        body: PNG,
      },
    ], undefined, undefined, { maxBytes: 64 });

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_TOO_LARGE',
    });
  });

  it('rejects a malformed content length', async () => {
    const fetcher = createFetcher([
      {
        statusCode: 200,
        headers: { 'content-length': 'not-a-number', 'content-type': 'image/png' },
        body: PNG,
      },
    ]);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_CONTENT_LENGTH_INVALID',
    });
  });

  it('stops a streamed response that exceeds the byte limit', async () => {
    const fetcher = createFetcher([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        body: Buffer.concat([PNG, Buffer.alloc(100)]),
      },
    ], undefined, undefined, { maxBytes: 32 });

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_TOO_LARGE',
    });
  });

  it.each([
    ['wrong content type', { 'content-type': 'text/html' }, PNG, 'REMOTE_ASSET_CONTENT_TYPE_INVALID'],
    ['PNG MIME with JPEG bytes', { 'content-type': 'image/png' }, JPEG, 'REMOTE_ASSET_MAGIC_BYTES_INVALID'],
    ['JPEG MIME with PNG bytes', { 'content-type': 'image/jpeg' }, PNG, 'REMOTE_ASSET_MAGIC_BYTES_INVALID'],
    ['encoded body', { 'content-encoding': 'gzip', 'content-type': 'image/png' }, PNG, 'REMOTE_ASSET_ENCODING_FORBIDDEN'],
  ])('rejects %s', async (_label, headers, body, code) => {
    const fetcher = createFetcher([{ statusCode: 200, headers, body }]);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({ code });
  });

  it('fails closed when the request exceeds its total timeout', async () => {
    const request: RemoteAssetRequest = () => {
      const client = new EventEmitter() as ClientRequest;
      client.end = jest.fn() as ClientRequest['end'];
      client.destroy = jest.fn(() => client) as ClientRequest['destroy'];
      return client;
    };
    const resolver: RemoteAssetResolver = async () => [{ address: PUBLIC_IPV4, family: 4 }];
    const fetcher = new SafeRemoteAssetFetcher({ timeoutMs: 5 }, resolver, request);

    await expect(fetcher.fetchImage('https://assets.example.com/logo.png')).rejects.toMatchObject({
      code: 'REMOTE_ASSET_TIMEOUT',
    });
  });

  it('keeps report logo rendering behind the safe fetcher without a direct fetch bypass', () => {
    const reportsSource = readFileSync(
      require.resolve('../../modules/reports/reports.service'),
      'utf8',
    );

    expect(reportsSource).toContain('SafeRemoteAssetFetcher');
    expect(reportsSource).toContain('remoteAssetFetcher.fetchImage');
    expect(reportsSource).not.toMatch(/\bfetch\s*\(/);
  });
});

function createFetcher(
  steps: ResponseStep[],
  resolver: RemoteAssetResolver = async () => [{ address: PUBLIC_IPV4, family: 4 }],
  captured: RequestOptions[] = [],
  options: ConstructorParameters<typeof SafeRemoteAssetFetcher>[0] = {},
): SafeRemoteAssetFetcher {
  return new SafeRemoteAssetFetcher(options, resolver, createFakeRequest(steps, captured));
}

function createFakeRequest(steps: ResponseStep[], captured: RequestOptions[]): RemoteAssetRequest {
  const queue = [...steps];
  return (options, onResponse) => {
    captured.push(options);
    const client = new EventEmitter() as ClientRequest;
    client.end = jest.fn(() => {
      const step = queue.shift();
      if (!step) {
        queueMicrotask(() => client.emit('error', new Error('missing fake response')));
        return client;
      }
      queueMicrotask(() => onResponse(createResponse(step)));
      return client;
    }) as ClientRequest['end'];
    client.destroy = jest.fn((error?: Error) => {
      if (error) {
        queueMicrotask(() => client.emit('error', error));
      }
      return client;
    }) as ClientRequest['destroy'];
    return client;
  };
}

function createResponse(step: ResponseStep): IncomingMessage {
  const response = Readable.from(step.body ? [step.body] : []) as IncomingMessage;
  response.statusCode = step.statusCode;
  response.headers = step.headers ?? {};
  return response;
}
