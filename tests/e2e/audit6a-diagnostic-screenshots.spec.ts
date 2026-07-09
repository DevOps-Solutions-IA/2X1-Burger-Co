import { expect, test } from '@playwright/test';

const DIR = 'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-6a-frontend-diagnostic';
const BASE = 'http://localhost';

const VIEWPORTS = {
  desktop1920: { w: 1920, h: 1080 },
  desktop1440: { w: 1440, h: 900 },
  desktop1366: { w: 1366, h: 768 },
  tablet1024: { w: 1024, h: 768 },
  tablet768: { w: 768, h: 1024 },
  mobile430: { w: 430, h: 932 },
  mobile390: { w: 390, h: 844 },
  mobile360: { w: 360, h: 740 },
};

const PAGES = [
  'dashboard', 'cash', 'pos', 'tables', 'deliveries', 'inventory',
  'products', 'purchases', 'expenses', 'reports', 'users',
  'categories', 'ingredients', 'suppliers', 'recipes', 'settings',
];

async function login(page: any) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('[data-testid="login-email"]', 'admin@2x1burgerco.local');
  await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

test.describe('AUDIT-6A: Diagnostic Screenshots', () => {
  test.setTimeout(600000);

  test('login page at all viewports', async ({ browser }) => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      const subdir = name.startsWith('desktop') ? 'desktop' : name.startsWith('tablet') ? 'tablet' : 'mobile';
      await page.screenshot({ path: `${DIR}/${subdir}/login_${name}.png`, fullPage: false });
      await ctx.close();
    }
  });

  test('all pages at desktop 1440', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page);

    for (const route of PAGES) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/desktop/${route}_1440.png`, fullPage: false });
    }
    await ctx.close();
  });

  test('all pages at tablet 1024x768', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await login(page);

    for (const route of ['dashboard', 'cash', 'pos', 'tables', 'inventory', 'products', 'reports', 'users']) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/tablet/${route}_1024.png`, fullPage: false });
    }
    await ctx.close();
  });

  test('key pages at mobile 390x844', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    // Login mobile
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${DIR}/mobile/login_390.png`, fullPage: false });

    // Login and test key pages
    await page.fill('[data-testid="login-email"]', 'admin@2x1burgerco.local');
    await page.fill('[data-testid="login-password"]', 'DevAdmin12345*');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    for (const route of ['dashboard', 'cash', 'pos', 'tables', 'reports']) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/mobile/${route}_390.png`, fullPage: false });
    }
    await ctx.close();
  });

  test('POS tablet 768x1024 portrait', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await ctx.newPage();
    await login(page);
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/tablet/pos_768x1024.png`, fullPage: false });
    await ctx.close();
  });

  test('waiter page mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/waiter/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="waiter-login-name"]', 'Mesero Principal');
    await page.fill('[data-testid="waiter-login-code"]', 'M124578');
    await page.click('[data-testid="waiter-login-submit"]');
    await page.waitForURL('**/waiter', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/mobile/waiter_390.png`, fullPage: false });
    await ctx.close();
  });

  test('delivery page', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/delivery/login`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="delivery-login-name"]', 'Domiciliario Principal');
    await page.fill('[data-testid="delivery-login-code"]', 'D124578');
    await page.click('[data-testid="delivery-login-submit"]');
    await page.waitForURL('**/delivery', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/desktop/delivery_1440.png`, fullPage: false });
    await ctx.close();
  });
});
