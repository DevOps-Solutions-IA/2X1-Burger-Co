import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.EPHEMERAL_WEB_BASE_URL;
const outputDir = process.env.EPHEMERAL_PLAYWRIGHT_OUTPUT;
if (!baseURL || !outputDir) throw new Error('Ephemeral Playwright URLs/output are required.');

export default defineConfig({
  testDir: '../../tests/e2e',
  testMatch: [
    'ephemeral/**/*.spec.ts',
    'phase7-payment-production-reachability.spec.ts',
    'sofia-manual-payments-phase-3.spec.ts',
    'sofia-online-payments-phase-5-6.spec.ts',
    'sofia-payment-link-page-phase-2.spec.ts',
    'sofia-pos-delivery-operations-phase-4.spec.ts',
  ],
  outputDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `${outputDir}/report.json` }]],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
