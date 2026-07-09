import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'path';

const defaultAuthRunId = `${Date.now()}-${process.pid}`;
const authRunId = process.env.PLAYWRIGHT_AUTH_RUN_ID ?? defaultAuthRunId;
const authDir = process.env.PLAYWRIGHT_AUTH_DIR ?? path.join('/tmp', 'playwright-auth', authRunId);
const AUTH_FILE = process.env.PLAYWRIGHT_AUTH_FILE ?? path.join(authDir, 'worker-0.json');
const adminEmail = 'admin@2x1burger.co';
const adminPassword = 'DevAdmin12345*';
setup.setTimeout(120_000);
type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

setup('authenticate', async ({ page, request }) => {
  mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  if (existsSync(AUTH_FILE)) {
    try {
      const storage = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as {
        cookies?: StoredCookie[];
      };

      if (storage.cookies?.length) {
        await page.context().addCookies(storage.cookies);
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

        if (/\/dashboard\/?$/.test(new URL(page.url()).pathname)) {
          await expect(page.getByText('Cargando sesión...')).toHaveCount(0, { timeout: 15000 });
          if (await page.getByTestId('app-main').isVisible({ timeout: 5000 }).catch(() => false)) {
            await page.context().storageState({ path: AUTH_FILE });
            return;
          }
        }
      }
    } catch {
      // Invalid or stale auth state falls through to a fresh login without exposing cookie values.
    }
  }

  const retryDelaysMs = [0, 10_000, 15_000, 20_000, 25_000];
  let lastStatus = 0;
  for (const [attempt, delayMs] of retryDelaysMs.entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const response = await request.post('/api/auth/login', {
      headers: { 'X-Forwarded-For': `10.250.${process.pid % 250}.${attempt + 1}` },
      data: { email: adminEmail, password: adminPassword },
    });
    lastStatus = response.status();
    if (response.status() === 201) {
      await request.storageState({ path: AUTH_FILE });
      return;
    }
    if (response.status() !== 429 && response.status() !== 503) {
      break;
    }
  }
  expect(lastStatus).toBe(201);
});

export { AUTH_FILE };
