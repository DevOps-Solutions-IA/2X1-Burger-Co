import { promises as dns } from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 2;
const MAX_URL_LENGTH = 2_048;

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type RemoteAssetLookupAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

export type RemoteAssetResolver = (hostname: string) => Promise<readonly RemoteAssetLookupAddress[]>;
export type RemoteAssetRequest = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export type SafeRemoteAssetFetcherOptions = Readonly<{
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}>;

export type SafeRemoteImage = Readonly<{
  bytes: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}>;

export class RemoteAssetSecurityError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RemoteAssetSecurityError';
  }
}

type FetchStepResult =
  | Readonly<{ kind: 'asset'; image: SafeRemoteImage }>
  | Readonly<{ kind: 'redirect'; location: string }>;

export class SafeRemoteAssetFetcher {
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;

  constructor(
    options: SafeRemoteAssetFetcherOptions = {},
    private readonly resolveHostname: RemoteAssetResolver = defaultResolver,
    private readonly request: RemoteAssetRequest = httpsRequest,
  ) {
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
    this.maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  }

  async fetchImage(rawUrl: string): Promise<SafeRemoteImage> {
    let currentUrl = this.parseAndValidateUrl(rawUrl);
    const visited = new Set<string>();

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      const canonicalUrl = currentUrl.toString();
      if (visited.has(canonicalUrl)) {
        throw new RemoteAssetSecurityError('REMOTE_ASSET_REDIRECT_LOOP');
      }
      visited.add(canonicalUrl);

      const pinnedAddress = await this.resolveAndValidate(currentUrl.hostname);
      const result = await this.fetchStep(currentUrl, pinnedAddress);
      if (result.kind === 'asset') {
        return result.image;
      }

      if (redirectCount === this.maxRedirects) {
        throw new RemoteAssetSecurityError('REMOTE_ASSET_REDIRECT_LIMIT');
      }
      try {
        currentUrl = this.parseAndValidateUrl(new URL(result.location, currentUrl).toString());
      } catch (error) {
        if (error instanceof RemoteAssetSecurityError) {
          throw error;
        }
        throw new RemoteAssetSecurityError('REMOTE_ASSET_REDIRECT_INVALID');
      }
    }

    throw new RemoteAssetSecurityError('REMOTE_ASSET_REDIRECT_LIMIT');
  }

  private parseAndValidateUrl(rawUrl: string): URL {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_INVALID_URL');
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_INVALID_URL');
    }

    if (url.protocol !== 'https:') {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_HTTPS_REQUIRED');
    }
    if (url.username || url.password) {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_CREDENTIALS_FORBIDDEN');
    }
    if (url.port && url.port !== '443') {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_PORT_FORBIDDEN');
    }

    const hostname = normalizeHostname(url.hostname);
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_HOST_FORBIDDEN');
    }

    url.hash = '';
    return url;
  }

  private async resolveAndValidate(rawHostname: string): Promise<RemoteAssetLookupAddress> {
    const hostname = normalizeHostname(rawHostname);
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily as 4 | 6 }]
      : await withTimeout(
          this.resolveHostname(hostname),
          this.timeoutMs,
          'REMOTE_ASSET_DNS_TIMEOUT',
        );

    if (addresses.length === 0 || addresses.length > 32) {
      throw new RemoteAssetSecurityError('REMOTE_ASSET_DNS_INVALID');
    }

    for (const candidate of addresses) {
      if (candidate.family !== 4 && candidate.family !== 6) {
        throw new RemoteAssetSecurityError('REMOTE_ASSET_DNS_INVALID');
      }
      if (isIP(candidate.address) !== candidate.family || !isGloballyRoutable(candidate.address)) {
        throw new RemoteAssetSecurityError('REMOTE_ASSET_ADDRESS_FORBIDDEN');
      }
    }

    return addresses[0]!;
  }

  private fetchStep(url: URL, pinnedAddress: RemoteAssetLookupAddress): Promise<FetchStepResult> {
    const hostname = normalizeHostname(url.hostname);
    const pinnedLookup: LookupFunction = (_lookupHostname, _options, callback) => {
      callback(null, pinnedAddress.address, pinnedAddress.family);
    };

    const requestOptions: RequestOptions = {
      protocol: 'https:',
      hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'image/png,image/jpeg',
        'user-agent': '2x1-burger-report-assets/1.0',
      },
      agent: false,
      lookup: pinnedLookup,
      servername: isIP(hostname) ? undefined : hostname,
    };

    return new Promise<FetchStepResult>((resolve, reject) => {
      let settled = false;
      let request: ClientRequest;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const fail = (error: Error) => finish(() => reject(error));
      const timer = setTimeout(() => {
        const error = new RemoteAssetSecurityError('REMOTE_ASSET_TIMEOUT');
        request?.destroy(error);
        fail(error);
      }, this.timeoutMs);
      timer.unref?.();

      try {
        request = this.request(requestOptions, (response) => {
          const statusCode = response.statusCode ?? 0;
          if (REDIRECT_STATUS_CODES.has(statusCode)) {
            const location = response.headers.location;
            response.destroy();
            if (!location) {
              fail(new RemoteAssetSecurityError('REMOTE_ASSET_REDIRECT_INVALID'));
              return;
            }
            finish(() => resolve({ kind: 'redirect', location }));
            return;
          }

          if (statusCode !== 200) {
            response.destroy();
            fail(new RemoteAssetSecurityError('REMOTE_ASSET_HTTP_STATUS'));
            return;
          }

          const contentEncoding = response.headers['content-encoding'];
          if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
            response.destroy();
            fail(new RemoteAssetSecurityError('REMOTE_ASSET_ENCODING_FORBIDDEN'));
            return;
          }

          const contentType = normalizeContentType(response.headers['content-type']);
          if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
            response.destroy();
            fail(new RemoteAssetSecurityError('REMOTE_ASSET_CONTENT_TYPE_INVALID'));
            return;
          }

          let declaredLength: number | null;
          try {
            declaredLength = parseContentLength(response.headers['content-length']);
          } catch (error) {
            response.destroy();
            fail(error instanceof Error ? error : new RemoteAssetSecurityError('REMOTE_ASSET_CONTENT_LENGTH_INVALID'));
            return;
          }
          if (declaredLength !== null && declaredLength > this.maxBytes) {
            response.destroy();
            fail(new RemoteAssetSecurityError('REMOTE_ASSET_TOO_LARGE'));
            return;
          }

          const chunks: Buffer[] = [];
          let byteLength = 0;

          response.on('data', (chunk: Buffer | string) => {
            if (settled) {
              return;
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteLength += buffer.length;
            if (byteLength > this.maxBytes) {
              response.destroy();
              fail(new RemoteAssetSecurityError('REMOTE_ASSET_TOO_LARGE'));
              return;
            }
            chunks.push(buffer);
          });
          response.once('aborted', () => fail(new RemoteAssetSecurityError('REMOTE_ASSET_ABORTED')));
          response.once('error', () => fail(new RemoteAssetSecurityError('REMOTE_ASSET_READ_FAILED')));
          response.once('end', () => {
            if (settled) {
              return;
            }
            const bytes = Buffer.concat(chunks, byteLength);
            if (!hasExpectedMagicBytes(bytes, contentType)) {
              fail(new RemoteAssetSecurityError('REMOTE_ASSET_MAGIC_BYTES_INVALID'));
              return;
            }
            finish(() =>
              resolve({
                kind: 'asset',
                image: {
                  bytes,
                  contentType: contentType as SafeRemoteImage['contentType'],
                },
              }),
            );
          });
        });
      } catch {
        fail(new RemoteAssetSecurityError('REMOTE_ASSET_REQUEST_FAILED'));
        return;
      }

      request.once('error', () => fail(new RemoteAssetSecurityError('REMOTE_ASSET_REQUEST_FAILED')));
      request.end();
    });
  }
}

async function defaultResolver(hostname: string): Promise<readonly RemoteAssetLookupAddress[]> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

function normalizeHostname(hostname: string): string {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.toLowerCase().replace(/\.$/, '');
}

function normalizeContentType(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) {
    return null;
  }
  return first.split(';', 1)[0]!.trim().toLowerCase();
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) {
    return null;
  }
  if (!/^\d+$/.test(first)) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_CONTENT_LENGTH_INVALID');
  }
  const parsed = Number(first);
  if (!Number.isSafeInteger(parsed)) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_CONTENT_LENGTH_INVALID');
  }
  return parsed;
}

function hasExpectedMagicBytes(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 4
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff
      && bytes[bytes.length - 1] === 0xd9;
  }
  return false;
}

function isGloballyRoutable(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !IPV4_FORBIDDEN_RANGES.some(([network, prefix]) => ipv4InCidr(address, network, prefix));
  }
  if (family === 6) {
    const mappedIpv4 = extractMappedIpv4(address);
    if (mappedIpv4) {
      return isGloballyRoutable(mappedIpv4);
    }
    return !IPV6_FORBIDDEN_RANGES.some(([network, prefix]) => ipv6InCidr(address, network, prefix));
  }
  return false;
}

const IPV4_FORBIDDEN_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_FORBIDDEN_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['::', 96],
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

function ipv4InCidr(address: string, network: string, prefix: number): boolean {
  const value = ipv4ToInteger(address);
  const networkValue = ipv4ToInteger(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (networkValue & mask);
}

function ipv4ToInteger(address: string): number {
  return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function extractMappedIpv4(address: string): string | null {
  const normalized = normalizeHostname(address);
  const match = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (match) {
    return match[1]!;
  }
  const value = ipv6ToBigInt(normalized);
  if ((value >> 32n) !== 0xffffn) {
    return null;
  }
  const ipv4 = Number(value & 0xffffffffn);
  return `${ipv4 >>> 24}.${(ipv4 >>> 16) & 0xff}.${(ipv4 >>> 8) & 0xff}.${ipv4 & 0xff}`;
}

function ipv6InCidr(address: string, network: string, prefix: number): boolean {
  const value = ipv6ToBigInt(address);
  const networkValue = ipv6ToBigInt(network);
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (networkValue >> shift);
}

function ipv6ToBigInt(address: string): bigint {
  let normalized = normalizeHostname(address);
  if (normalized.includes('%')) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_ADDRESS_FORBIDDEN');
  }

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = normalized.slice(lastColon + 1);
    const value = ipv4ToInteger(ipv4);
    normalized = `${normalized.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_DNS_INVALID');
  }
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_DNS_INVALID');
  }
  const segments = halves.length === 2
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left;
  if (segments.length !== 8 || segments.some((segment) => !/^[0-9a-f]{1,4}$/i.test(segment))) {
    throw new RemoteAssetSecurityError('REMOTE_ASSET_DNS_INVALID');
  }
  return segments.reduce((value, segment) => (value << 16n) | BigInt(`0x${segment}`), 0n);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RemoteAssetSecurityError(code)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(new RemoteAssetSecurityError('REMOTE_ASSET_DNS_FAILED'));
      },
    );
  });
}
