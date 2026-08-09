import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:3302',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command:
        'bash -lc "bash infra/scripts/prepare-test-db.sh && source infra/scripts/load-env.sh && NODE_ENV=test PORT=4301 CORS_ORIGIN=http://127.0.0.1:3302 APP_URL=http://127.0.0.1:3302 pnpm --filter @inventory-fastfood/api start:dev"',
      url: 'http://127.0.0.1:4301/health/ready',
      timeout: 120000,
      reuseExistingServer: true,
    },
    {
      command:
        'bash -lc "rm -rf apps/web/.next && set -a; source .env 2>/dev/null || source .env.example; set +a; NODE_ENV=test PORT=3302 NEXT_PUBLIC_API_URL=http://127.0.0.1:4301 pnpm --filter @inventory-fastfood/web dev"',
      url: 'http://127.0.0.1:3302/login',
      timeout: 120000,
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /waiter\.mobile\.spec\.ts/,
    },
    {
      name: 'waiter-mobile',
      use: {
        ...devices['Pixel 5'],
        baseURL: 'http://127.0.0.1:3302',
      },
      testMatch: /waiter\.mobile\.spec\.ts/,
    },
  ],
});
