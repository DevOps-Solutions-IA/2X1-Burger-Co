import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await page.goto('http://localhost:3301/login', { waitUntil: 'networkidle' });
await page.getByLabel(/correo/i).fill('admin@2x1burgerco.local');
await page.getByLabel(/contraseña/i).fill('Admin12345*');
await page.getByRole('button', { name: /iniciar sesión/i }).click();
await page.waitForURL('**/dashboard');
await page.goto('http://localhost:3301/tables', { waitUntil: 'networkidle' });
await page.screenshot({ path: '.tmp/tables.png', fullPage: true });
await browser.close();
