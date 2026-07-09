import { defineConfig } from '@playwright/test';
import path from 'path';

const defaultAuthRunId = `noserver-${Date.now()}-${process.pid}`;
const authRunId = process.env.PLAYWRIGHT_AUTH_RUN_ID ?? defaultAuthRunId;
const authDir = process.env.PLAYWRIGHT_AUTH_DIR ?? path.join('/tmp', 'playwright-auth', authRunId);
const AUTH_FILE = process.env.PLAYWRIGHT_AUTH_FILE ?? path.join(authDir, 'worker-0.json');

process.env.PLAYWRIGHT_AUTH_DIR = authDir;
process.env.PLAYWRIGHT_AUTH_FILE = AUTH_FILE;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],
});
