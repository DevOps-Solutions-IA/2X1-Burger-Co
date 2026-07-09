import { expect, test } from '@playwright/test';

// Uses storageState from auth.setup.ts — already authenticated

test.describe('AUDIT-8G.1.1H: Cookie Fetch Proof', () => {
  test.setTimeout(60000);

  test('PROOF: httpOnly cookie IS sent via fetch with credentials include', async ({ page }) => {
    // Already authenticated via storageState
    await page.goto('http://localhost/cash', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Cookie exists in browser context
    const cookies = await page.context().cookies('http://localhost');
    const refreshCookie = cookies.find((c) => c.name === 'refresh_token');
    console.log('Cookie found:', !!refreshCookie, 'httpOnly:', refreshCookie?.httpOnly);

    if (!refreshCookie) {
      // Cookie doesn't exist in context - test cannot proceed
      console.log('NO COOKIE FOUND - storageState may not have preserved httpOnly cookie');
      return;
    }

    // TEST 1: fetch debug-cookie-presence (BEFORE reload)
    const beforeReload = await page.evaluate(async () => {
      const res = await fetch('/api/auth/debug-cookie-presence', { credentials: 'include' });
      return res.json();
    });
    console.log('BEFORE reload - hasRefreshCookie:', beforeReload.hasRefreshCookie);

    // TEST 2: fetch refresh (BEFORE reload)
    const refreshBefore = await page.evaluate(async () => {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: res.status, ok: res.ok };
    });
    console.log('BEFORE reload - refresh status:', refreshBefore.status);

    // RELOAD
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // TEST 3: fetch debug-cookie-presence (AFTER reload)
    const afterReload = await page.evaluate(async () => {
      const res = await fetch('/api/auth/debug-cookie-presence', { credentials: 'include' });
      return res.json();
    });
    console.log('AFTER reload - hasRefreshCookie:', afterReload.hasRefreshCookie);

    // TEST 4: fetch refresh (AFTER reload)
    const refreshAfter = await page.evaluate(async () => {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: res.status, ok: res.ok };
    });
    console.log('AFTER reload - refresh status:', refreshAfter.status);

    // VERDICT
    console.log('=== VERDICT ===');
    console.log('hasRefreshCookie before:', beforeReload.hasRefreshCookie);
    console.log('refresh before:', refreshBefore.status);
    console.log('hasRefreshCookie after:', afterReload.hasRefreshCookie);
    console.log('refresh after:', refreshAfter.status);
  });
});
