import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectAccessiblePage(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));

  expect(violations, 'WCAG 2 A/AA violations').toEqual([]);
}

export function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Chromium mirrors failed HTTP requests to console without the request URL.
    // Response handling below preserves route-aware validation instead.
    if (message.text().startsWith('Failed to load resource:')) return;
    errors.push(message.text());
  });
  page.on('response', (response) => {
    const status = response.status();
    const isAnonymousRefreshProbe =
      status === 401 && /\/api\/auth\/refresh(?:\?|$)/.test(response.url());
    if (status >= 500 || (status === 401 && !isAnonymousRefreshProbe)) {
      errors.push(`${status} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
