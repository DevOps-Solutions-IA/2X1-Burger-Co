import { DiningTableStatus, OrderTicketStatus, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { test, expect } from './fixtures/worker-auth';
import { expectAccessiblePage } from './ephemeral/accessibility';

const prisma = new PrismaClient();
const waiterName = 'Mesero Principal';
const waiterCode = 'M124578';
const waiterTableLabel = 'Mesa E2E Waiter';

async function ensureWaiterFixture() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'waiter' } });
  const waiter = await prisma.user.upsert({
    where: { email: 'waiter@2x1burgerco.local' },
    update: {
      fullName: waiterName,
      accessName: waiterName.toLowerCase(),
      accessCodeHash: await hash(waiterCode, 12),
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ roleId: role.id }],
      },
    },
    create: {
      email: 'waiter@2x1burgerco.local',
      fullName: waiterName,
      accessName: waiterName.toLowerCase(),
      accessCodeHash: await hash(waiterCode, 12),
      passwordHash: await hash('Waiter12345*', 12),
      isActive: true,
      roles: {
        create: [{ roleId: role.id }],
      },
    },
  });
  let table = await prisma.diningTable.findFirst({ where: { label: waiterTableLabel } });
  if (!table) {
    table = await prisma.diningTable.create({
      data: {
        label: waiterTableLabel,
        area: 'E2E',
        capacity: 4,
        status: DiningTableStatus.FREE,
        isActive: true,
      },
    });
  } else {
    table = await prisma.diningTable.update({
      where: { id: table.id },
      data: {
        status: DiningTableStatus.FREE,
        isActive: true,
      },
    });
  }

  await prisma.orderTicket.updateMany({
    where: {
      tableId: table.id,
      status: {
        in: [
          OrderTicketStatus.OPEN,
          OrderTicketStatus.IN_PREPARATION,
          OrderTicketStatus.SERVED,
          OrderTicketStatus.PAYMENT_PENDING,
        ],
      },
    },
    data: { status: OrderTicketStatus.CANCELLED },
  });
  await prisma.waiterTableAssignment.updateMany({
    where: {
      tableId: table.id,
      isActive: true,
      waiterId: { not: waiter.id },
    },
    data: { isActive: false },
  });
  await prisma.waiterTableAssignment.upsert({
    where: {
      waiterId_tableId_isActive: {
        waiterId: waiter.id,
        tableId: table.id,
        isActive: true,
      },
    },
    update: { assignedAt: new Date() },
    create: {
      waiterId: waiter.id,
      tableId: table.id,
      isActive: true,
    },
  });
}

async function ensureNamedWaiter(fullName: string, accessName: string, accessCode: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'waiter' } });
  return prisma.user.upsert({
    where: { email: `${accessName.toLowerCase().replace(/\s+/g, '.')}@2x1burgerco.local` },
    update: {
      fullName,
      accessName: accessName.toLowerCase(),
      accessCodeHash: await hash(accessCode, 12),
      isActive: true,
      roles: {
        deleteMany: {},
        create: [{ roleId: role.id }],
      },
    },
    create: {
      email: `${accessName.toLowerCase().replace(/\s+/g, '.')}@2x1burgerco.local`,
      fullName,
      accessName: accessName.toLowerCase(),
      accessCodeHash: await hash(accessCode, 12),
      passwordHash: await hash(`${accessName}12345*`, 12),
      isActive: true,
      roles: {
        create: [{ roleId: role.id }],
      },
    },
  });
}

async function ensureDiningTable(label: string) {
  return prisma.diningTable.upsert({
    where: { label },
    update: {
      area: 'E2E',
      capacity: 4,
      status: DiningTableStatus.FREE,
      isActive: true,
    },
    create: {
      label,
      area: 'E2E',
      capacity: 4,
      status: DiningTableStatus.FREE,
      isActive: true,
    },
  });
}

async function loginAsWaiter(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/waiter/login');
  await page.getByTestId('waiter-login-name').fill(waiterName);
  await page.getByTestId('waiter-login-code').fill(waiterCode);
  await expect(page.getByTestId('waiter-login-submit')).toBeEnabled();
  await page.getByTestId('waiter-login-submit').click({ force: true });
  await expect(page).toHaveURL(/\/waiter\/?$/);
}

async function ensureCashOpen(accessToken: string, request: import('@playwright/test').APIRequestContext) {
  const current = await request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(current.ok()).toBeTruthy();
  const body = await current.json();
  if (body) {
    return;
  }

  const opened = await request.post('/api/cash-register/open', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { openingAmount: 80000 },
  });
  expect([200, 201, 409]).toContain(opened.status());
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.describe.serial('Waiter table-only flows', () => {
  test.beforeAll(async () => {
    await ensureWaiterFixture();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('waiter login opens the current table-only workspace', async ({ page }) => {
    await loginAsWaiter(page);

    await expect(page.getByRole('heading', { name: waiterName })).toBeVisible();
    await expect(page.getByText(/mesas libres/i)).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(waiterTableLabel) })).toBeVisible();
    await expect(page.getByText(/domicilio/i)).toHaveCount(0);
  });

  test('waiter can save a table order and API keeps waiter snapshot', async ({ page, request, workerAccessToken }) => {
    await ensureCashOpen(workerAccessToken, request);
    await loginAsWaiter(page);

    await page.getByRole('button', { name: new RegExp(waiterTableLabel) }).click();
    await expect(page.getByRole('heading', { name: new RegExp(waiterTableLabel) })).toBeVisible();
    await page.locator('button:not([disabled])').filter({ hasText: /COP/ }).first().click();
    await page.getByTestId('waiter-save-order').click();
    await expect(page.getByText(/^1 mias$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`${waiterTableLabel}.*Con servicio`, 's') })).toBeVisible();

    const response = await request.get('/api/orders?activeOnly=true', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
    });
    expect(response.ok()).toBeTruthy();
    const orders = (await response.json()) as Array<{
      type: string;
      table?: { label?: string | null } | null;
      waiterNameSnapshot?: string | null;
      assignedWaiter?: { fullName?: string | null } | null;
    }>;
    const tableOrder = orders.find((order) => order.type === 'DINE_IN' && order.table?.label === waiterTableLabel);

    expect(tableOrder).toBeTruthy();
    expect(tableOrder?.waiterNameSnapshot ?? tableOrder?.assignedWaiter?.fullName).toBe(waiterName);
  });

  test('enterprise reassignment replaces responsible waiter and direct table assignment has priority', async ({ request, workerAccessToken }) => {
    await ensureCashOpen(workerAccessToken, request);
    const andres = await ensureNamedWaiter('Andrés Mesero', 'Andrés', 'M111222');
    const virginia = await ensureNamedWaiter('Virginia Mesera', 'Virginia', 'M333444');
    const [tableTwo, tableThree] = await Promise.all([
      ensureDiningTable('Mesa #2'),
      ensureDiningTable('Mesa #3'),
    ]);
    const burger = await prisma.product.findFirstOrThrow({ where: { code: 'HAMB-2X1', isActive: true } });
    const groupName = `Exterior E2E ${Date.now()}`;

    const group = await request.post('/api/table-groups', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { name: groupName, area: 'Exterior' },
    });
    expect(group.ok()).toBeTruthy();
    const groupBody = (await group.json()) as { id: string };

    for (const table of [tableTwo, tableThree]) {
      const added = await request.post(`/api/table-groups/${groupBody.id}/tables`, {
        headers: { Authorization: `Bearer ${workerAccessToken}` },
        data: { tableId: table.id },
      });
      expect(added.ok()).toBeTruthy();
    }

    const assignedVirginia = await request.post('/api/waiter-assignments', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { waiterId: virginia.id, scope: 'GROUP', tableGroupId: groupBody.id },
    });
    expect(assignedVirginia.ok()).toBeTruthy();

    const virginiaLogin = await request.post('/api/auth/waiter-login', {
      data: { name: 'Virginia', accessCode: 'M333444' },
    });
    expect(virginiaLogin.ok()).toBeTruthy();
    const virginiaToken = ((await virginiaLogin.json()) as { accessToken: string }).accessToken;

    const virginiaBefore = await request.get('/api/tables/waiter', {
      headers: { Authorization: `Bearer ${virginiaToken}` },
    });
    expect(virginiaBefore.ok()).toBeTruthy();
    expect(((await virginiaBefore.json()) as Array<{ id: string }>).map((table) => table.id)).toEqual(
      expect.arrayContaining([tableTwo.id, tableThree.id]),
    );

    const historicalOrder = await request.post('/api/orders/waiter-sync', {
      headers: { Authorization: `Bearer ${virginiaToken}` },
      data: {
        tableId: tableTwo.id,
        status: 'OPEN',
        clientMutationId: `enterprise-virginia-${Date.now()}`,
        items: [{ productId: burger.id, quantity: 1 }],
      },
    });
    expect(historicalOrder.ok()).toBeTruthy();
    const historicalBody = (await historicalOrder.json()) as { id: string; waiterNameSnapshot: string };
    expect(historicalBody.waiterNameSnapshot).toBe('Virginia Mesera');

    const reassigned = await request.post('/api/waiter-assignments', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { waiterId: andres.id, scope: 'GROUP', tableGroupId: groupBody.id },
    });
    expect(reassigned.ok()).toBeTruthy();

    const andresLogin = await request.post('/api/auth/waiter-login', {
      data: { name: 'Andrés', accessCode: 'M111222' },
    });
    expect(andresLogin.ok()).toBeTruthy();
    const andresToken = ((await andresLogin.json()) as { accessToken: string }).accessToken;

    const [virginiaAfter, andresAfter] = await Promise.all([
      request.get('/api/tables/waiter', { headers: { Authorization: `Bearer ${virginiaToken}` } }),
      request.get('/api/tables/waiter', { headers: { Authorization: `Bearer ${andresToken}` } }),
    ]);
    expect(virginiaAfter.ok()).toBeTruthy();
    expect(andresAfter.ok()).toBeTruthy();
    expect(((await virginiaAfter.json()) as Array<{ id: string }>).map((table) => table.id)).not.toContain(tableThree.id);
    expect(((await andresAfter.json()) as Array<{ id: string }>).map((table) => table.id)).toEqual(
      expect.arrayContaining([tableTwo.id, tableThree.id]),
    );

    const renamed = await request.patch(`/api/table-groups/${groupBody.id}`, {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { name: `${groupName} Terraza`, area: 'Terraza Exterior' },
    });
    expect(renamed.ok()).toBeTruthy();
    expect(((await renamed.json()) as { name: string }).name).toContain('Terraza');

    const directVirginia = await request.post('/api/waiter-assignments', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
      data: { waiterId: virginia.id, scope: 'TABLE', tableId: tableThree.id },
    });
    expect(directVirginia.ok()).toBeTruthy();

    const [virginiaDirect, andresDirect] = await Promise.all([
      request.get('/api/tables/waiter', { headers: { Authorization: `Bearer ${virginiaToken}` } }),
      request.get('/api/tables/waiter', { headers: { Authorization: `Bearer ${andresToken}` } }),
    ]);
    expect(((await virginiaDirect.json()) as Array<{ id: string }>).map((table) => table.id)).toContain(tableThree.id);
    expect(((await andresDirect.json()) as Array<{ id: string }>).map((table) => table.id)).not.toContain(tableThree.id);

    const activeGroupAssignments = await prisma.waiterTableGroupAssignment.findMany({
      where: { tableGroupId: groupBody.id, isActive: true },
    });
    expect(activeGroupAssignments).toHaveLength(1);
    expect(activeGroupAssignments.at(0)?.waiterId).toBe(andres.id);

    const persistedHistoricalOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: historicalBody.id },
      select: { waiterNameSnapshot: true },
    });
    expect(persistedHistoricalOrder.waiterNameSnapshot).toBe('Virginia Mesera');
  });

  test('waiter assignment endpoints are reachable for admin and protected for waiter', async ({ page, request, workerAccessToken }) => {
    const groups = await request.get('/api/table-groups', {
      headers: { Authorization: `Bearer ${workerAccessToken}` },
    });
    expect(groups.ok()).toBeTruthy();

    const waiterLogin = await request.post('/api/auth/waiter-login', {
      data: { name: waiterName, accessCode: waiterCode },
    });
    expect(waiterLogin.ok()).toBeTruthy();
    const waiterBody = (await waiterLogin.json()) as { accessToken: string };
    const denied = await request.get('/api/waiter-assignments', {
      headers: { Authorization: `Bearer ${waiterBody.accessToken}` },
    });
    expect(denied.status()).toBe(403);
  });

  test('waiter panel exposes manifest and service worker', async ({ page }) => {
    await loginAsWaiter(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe('2X1 Burger Co · Meseros');

    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      return Boolean(registration);
    });
  });

  test('waiter standalone workflow is keyboard accessible at phone and tablet widths', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsWaiter(page);

    const table = page.getByRole('button', { name: new RegExp(waiterTableLabel) });
    await expect(table).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessiblePage(page);

    await table.focus();
    await table.press('Enter');
    const back = page.getByRole('button', { name: 'Cerrar comanda y volver a las mesas' });
    await expect(back).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await back.focus();
    await back.press('Enter');
    await expect(table).toBeVisible();

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(table).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessiblePage(page);
  });
});
