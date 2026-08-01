import { pathToFileURL } from 'node:url';
import { validateInternalApiUrl } from './web-runtime-url.mjs';

export async function checkInternalApiHealth(value, request = fetch) {
  const origin = validateInternalApiUrl(value);
  let response;
  try {
    response = await request(`${origin}/health/ready`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw new Error('WEB_INTERNAL_API_UNAVAILABLE');
  }
  if (!response.ok) throw new Error('WEB_INTERNAL_API_UNHEALTHY');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkInternalApiHealth(process.env.INTERNAL_API_URL);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'WEB_INTERNAL_API_UNHEALTHY'}\n`);
    process.exitCode = 1;
  }
}
