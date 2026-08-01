import { pathToFileURL } from 'node:url';

const INVALID_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function validateInternalApiUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error('WEB_INTERNAL_API_URL_REQUIRED');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEB_INTERNAL_API_URL_INVALID');
  }
  if (
    url.protocol !== 'http:' ||
    INVALID_HOSTS.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('WEB_INTERNAL_API_URL_INVALID');
  }
  return url.origin;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${validateInternalApiUrl(process.env.INTERNAL_API_URL)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'WEB_INTERNAL_API_URL_INVALID'}\n`);
    process.exitCode = 1;
  }
}
