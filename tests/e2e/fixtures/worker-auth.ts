/* eslint-disable no-empty-pattern, react-hooks/rules-of-hooks, security/detect-non-literal-fs-filename */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, request as playwrightRequest, test as base } from '@playwright/test';

type WorkerAuthState = {
  file: string;
  accessToken: string;
};

const authPromises = new Map<number, Promise<WorkerAuthState>>();

async function createWorkerAuth(workerIndex: number): Promise<WorkerAuthState> {
  const authDir = process.env.PLAYWRIGHT_AUTH_DIR ?? path.join('/tmp', 'playwright-auth', `${Date.now()}-${process.pid}`);
  const file = path.join(authDir, `e2e-worker-${workerIndex}.json`);
  mkdirSync(authDir, { recursive: true });
  const credentials = {
    email: process.env.EPHEMERAL_ADMIN_EMAIL,
    password: process.env.EPHEMERAL_ADMIN_PASSWORD,
  };
  if (!credentials.email || !credentials.password) {
    throw new Error('Ephemeral admin credentials are required for worker authentication.');
  }

  const request = await playwrightRequest.newContext({
    baseURL: process.env.EPHEMERAL_WEB_BASE_URL,
    storageState: existsSync(file) ? file : undefined,
  });

  try {
    if (existsSync(file)) {
      const refreshResponse = await request.post('/api/auth/refresh');
      if (refreshResponse.ok()) {
        const body = (await refreshResponse.json()) as { accessToken?: string };
        if (body.accessToken) {
          await request.storageState({ path: file });
          return { file, accessToken: body.accessToken };
        }
      }
    }

    const retryDelaysMs = [0, 10_000, 15_000, 20_000, 25_000, 45_000, 60_000];
    let lastStatus = 0;
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const response = await request.post('/api/auth/login', {
        data: credentials,
      });
      lastStatus = response.status();
      if (response.status() === 201) {
        const body = (await response.json()) as { accessToken?: string };
        expect(body.accessToken).toBeTruthy();
        await request.storageState({ path: file });
        return { file, accessToken: body.accessToken! };
      }
      if (response.status() !== 429 && response.status() !== 503) {
        break;
      }
    }
    expect(lastStatus).toBe(201);
    throw new Error('worker auth login did not return an access token');
  } finally {
    await request.dispose();
  }
}

async function getWorkerAuth(workerIndex: number) {
  const existing = authPromises.get(workerIndex);
  if (existing) return existing;
  const created = createWorkerAuth(workerIndex);
  authPromises.set(workerIndex, created);
  return created;
}

export const test = base.extend<
  { workerAccessToken: string; workerAuthFile: string; persistWorkerStorage: void },
  { workerAuthState: WorkerAuthState }
>({
  workerAuthState: [
    async ({}, use, workerInfo) => {
      await use(await getWorkerAuth(workerInfo.workerIndex));
    },
    { scope: 'worker', timeout: 190_000 },
  ],
  storageState: async ({ workerAuthState }, use) => {
    await use(workerAuthState.file);
  },
  workerAccessToken: async ({ workerAuthState }, use) => {
    await use(workerAuthState.accessToken);
  },
  workerAuthFile: async ({ workerAuthState }, use) => {
    await use(workerAuthState.file);
  },
  persistWorkerStorage: [
    async ({ context, workerAuthState }, use) => {
      await use();
      await context.storageState({ path: workerAuthState.file }).catch(() => undefined);
    },
    { auto: true },
  ],
});

export { expect };
