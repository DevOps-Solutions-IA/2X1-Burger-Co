import fs from 'node:fs/promises';

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export const apiBase = () => requiredEnv('EPHEMERAL_API_BASE_URL');

export async function apiRequest(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${apiBase()}${path}`, options);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  if (!expected.includes(response.status)) throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}.`);
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
}

export async function login(email, password) {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.body?.accessToken) throw new Error(`Login failed for ${email.split('@')[0]}.`);
  return response.body.accessToken;
}

export async function accessCodeLogin(kind, name, accessCode) {
  const response = await apiRequest(`/auth/${kind}-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, accessCode }),
  });
  if (!response.body?.accessToken) throw new Error(`${kind} login failed.`);
  return response.body.accessToken;
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function assertNoSensitiveFields(value, context) {
  const forbidden = /^(passwordHash|tokenHash|refreshToken|databaseUrl|qrString|authState|sessionAuth|rawPayload)$/i;
  const walk = (item) => {
    if (!item || typeof item !== 'object' || Buffer.isBuffer(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.test(key) && child != null) throw new Error(`${context} exposed sensitive field ${key}.`);
      walk(child);
    }
  };
  walk(value);
}

export async function writeJson(name, value) {
  const dir = requiredEnv('EPHEMERAL_EVIDENCE_DIR');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
