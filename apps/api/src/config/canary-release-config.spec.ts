import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEnv } from './env';

const composePath = resolve(
  __dirname,
  '../../../../infra/release/docker-compose.canary.yml',
);

function readApiEnvironment(): Record<string, string> {
  const compose = readFileSync(composePath, 'utf8');
  const block = compose.match(/environment: &api-environment\n((?: {6}[^\n]*\n)+)/)?.[1];

  if (!block) {
    throw new Error('CANARY_API_ENVIRONMENT_NOT_FOUND');
  }

  return Object.fromEntries(
    block
      .split('\n')
      .flatMap((line) => {
        const match = line.match(/^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/);
        const key = match?.[1];
        const rawValue = match?.[2];

        return key && rawValue !== undefined
          ? [[key, rawValue.replace(/^"|"$/g, '')]]
          : [];
      }),
  );
}

describe('production canary release configuration', () => {
  it('passes the production environment validator with isolated HTTPS identities', () => {
    const compose = readFileSync(composePath, 'utf8');
    const canaryEnv = readApiEnvironment();
    const validated = validateEnv({
      ...canaryEnv,
      DATABASE_URL: 'postgresql://canary:canary@canary-postgres:5432/canary?schema=public',
      JWT_ACCESS_SECRET: 'canary-test-access-secret-with-at-least-thirty-two-characters',
      JWT_REFRESH_SECRET: 'canary-test-refresh-secret-with-at-least-thirty-two-characters',
      ADMIN_EMAIL: 'canary-admin@example.test',
      ADMIN_PASSWORD: 'CanaryTestPassword123!',
      CORS_ORIGIN: 'https://canary-web.2x1burger.example',
      APP_URL: 'https://canary-web.2x1burger.example',
      PUBLIC_PAYMENTS_BASE_URL: 'https://canary-pay.2x1burger.example',
      SOFIA_QR_PILOT_ALLOWED_PHONES: 'test-only-disabled-allowlist',
      RELEASE_ARTIFACT_DIGEST: 'sha256:test-only-canary-digest',
    });

    expect(validated.NODE_ENV).toBe('production');
    expect(validated.COOKIE_SECURE).toBe(true);
    expect(validated.APP_URL).toBe('https://canary-web.2x1burger.example');
    expect(validated.PUBLIC_PAYMENTS_BASE_URL).toBe(
      'https://canary-pay.2x1burger.example',
    );
    expect(validated.CORS_ORIGIN).toBe('https://canary-web.2x1burger.example');

    expect(canaryEnv.CORS_ORIGIN).toBe('${CANARY_PUBLIC_WEB_ORIGIN:?required}');
    expect(canaryEnv.APP_URL).toBe('${CANARY_PUBLIC_WEB_ORIGIN:?required}');
    expect(canaryEnv.PUBLIC_PAYMENTS_BASE_URL).toBe(
      '${CANARY_PUBLIC_PAYMENTS_BASE_URL:?required}',
    );
    expect(compose).toContain('NEXT_PUBLIC_API_URL: ${CANARY_PUBLIC_API_URL:?required}');
    expect(compose).toContain('INTERNAL_API_URL: http://api:3000');
    expect(compose).toContain('127.0.0.1:${CANARY_API_PORT:-4400}:3000');
    expect(compose).toContain('127.0.0.1:${CANARY_WEB_PORT:-3401}:3001');
  });
});
