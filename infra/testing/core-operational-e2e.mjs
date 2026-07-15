import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { authHeaders, login, requiredEnv, writeJson } from './runtime-client.mjs';

const apiBase = requiredEnv('EPHEMERAL_API_BASE_URL');
const evidenceDir = requiredEnv('EPHEMERAL_EVIDENCE_DIR');
const prisma = new PrismaClient();
const timings = {};
const requestIds = new Set();

function elapsed(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

async function timed(name, operation) {
  const start = process.hrtime.bigint();
  try {
    return await operation();
  } finally {
    timings[name] = Math.round(elapsed(start) * 100) / 100;
  }
}

async function request(path, { method = 'GET', token, body, expected = [200, 201] } = {}) {
  const requestId = crypto.randomUUID();
  const correlationId = `core:${requiredEnv('EPHEMERAL_TEST_RUN_ID')}`.slice(0, 128);
  const idempotencyKey = method === 'GET' ? null : `core:${crypto.randomUUID()}`;
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? authHeaders(token) : { 'Content-Type': 'application/json' }),
      'X-Request-Id': requestId,
      'X-Correlation-Id': correlationId,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseRequestId = response.headers.get('x-request-id');
  if (responseRequestId) requestIds.add(responseRequestId);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  if (expected && !expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: payload,
    auditContext: { requestId, correlationId, idempotencyKey },
  };
}

const get = (path, token, expected) => request(path, { token, expected });
const post = (path, body, token, expected) => request(path, { method: 'POST', token, body, expected });
const put = (path, body, token, expected) => request(path, { method: 'PUT', token, body, expected });

function countStatus(responses, status) {
  return responses.filter((response) => response.status === status).length;
}

function decimal(value) {
  return Number(value ?? 0);
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function renderPdf(name, buffer) {
  const pdfPath = `${evidenceDir}/${name}.pdf`;
  const textPath = `${evidenceDir}/${name}.txt`;
  const pngPath = `${evidenceDir}/${name}.png`;
  await fs.writeFile(pdfPath, buffer, { mode: 0o600 });
  execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', `-sOutputFile=${textPath}`, pdfPath]);
  execFileSync('gs', [
    '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', '-r144',
    `-sOutputFile=${pngPath}`, pdfPath,
  ]);
  const text = await fs.readFile(textPath, 'utf8');
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  return { pdfPath, textPath, pngPath, text, normalizedText, sha256: hashBuffer(buffer), bytes: buffer.length };
}

async function databaseFingerprint() {
  const [sales, orders, cashSessions, cashMovements, inventoryMovements, purchases, audits] = await Promise.all([
    prisma.sale.count(),
    prisma.orderTicket.count(),
    prisma.cashSession.count(),
    prisma.cashMovement.count(),
    prisma.inventoryMovement.count(),
    prisma.purchase.count(),
    prisma.auditLog.count(),
  ]);
  return { sales, orders, cashSessions, cashMovements, inventoryMovements, purchases, audits };
}

async function assertEphemeralDatabase() {
  const result = await prisma.$queryRaw`SELECT current_database() AS name`;
  const databaseName = result[0]?.name ?? '';
  const runId = requiredEnv('EPHEMERAL_TEST_RUN_ID');
  const marker = runId.replaceAll('-', '_').slice(-24);
  assert.equal(process.env.EPHEMERAL_TEST_MODE, 'true');
  assert.ok(databaseName.endsWith('_test'));
  assert.ok(databaseName.includes(marker));
  return { databaseName: databaseName.replace(marker, '[RUN_ID]'), markerValidated: true };
}

async function main() {
  const isolation = await assertEphemeralDatabase();
  const adminToken = await login(requiredEnv('EPHEMERAL_ADMIN_EMAIL'), requiredEnv('EPHEMERAL_ADMIN_PASSWORD'));
  const cashierToken = await login(requiredEnv('EPHEMERAL_CASHIER_EMAIL'), requiredEnv('EPHEMERAL_CASHIER_PASSWORD'));
  const inventoryToken = await login(requiredEnv('EPHEMERAL_INVENTORY_EMAIL'), requiredEnv('EPHEMERAL_INVENTORY_PASSWORD'));
  const noAccessToken = await login('no-access.e2e@invalid.local', 'NoAccess-E2E-2300!');
  const baseline = await databaseFingerprint();

  const productsResponse = await get('/products/sellable', adminToken);
  const products = productsResponse.body;
  const soda = products.find((item) => item.code === 'CC-ORG-400');
  const burger = products.find((item) => item.code === 'HAMB-2X1');
  assert.ok(soda && burger, 'Deterministic products are required.');
  const cashMethods = await get('/payment-methods', adminToken);
  const cashMethod = cashMethods.body.find((item) => item.code === 'cash');
  assert.ok(cashMethod);

  const results = {
    isolation,
    cash: {},
    pos: {},
    delivery: {},
    inventory: {},
    rbac: {},
    audit: {},
    performanceMs: timings,
  };

  // Caja: close is guarded by status and reopen must produce a single successor.
  const currentCash = await get('/cash-register/current', adminToken);
  assert.ok(currentCash.body?.id);
  const summary = await get('/cash-register/daily-summary', adminToken);
  const expectedPhysicalCash = decimal(summary.body.expectedPhysicalCash);
  const closeResponses = await timed('cashConcurrentClose', () => Promise.all([
    post('/cash-register/close', { actualAmount: expectedPhysicalCash, notes: 'Phase 2.5 concurrent close A' }, adminToken, null),
    post('/cash-register/close', { actualAmount: expectedPhysicalCash, notes: 'Phase 2.5 concurrent close B' }, adminToken, null),
  ]));
  assert.equal(countStatus(closeResponses, 201), 1, 'Exactly one concurrent cash close must succeed.');
  assert.equal(closeResponses.filter((item) => [400, 409].includes(item.status)).length, 1);
  const closedCash = closeResponses.find((item) => item.status === 201).body;
  assert.equal(await prisma.cashMovement.count({ where: { cashSessionId: closedCash.id, type: 'CLOSING' } }), 1);

  const reopenResponses = await timed('cashConcurrentReopen', () => Promise.all([
    post('/cash-register/reopen', { sessionId: closedCash.id, reason: 'Phase 2.5 controlled reopen A' }, adminToken, null),
    post('/cash-register/reopen', { sessionId: closedCash.id, reason: 'Phase 2.5 controlled reopen B' }, adminToken, null),
  ]));
  assert.equal(countStatus(reopenResponses, 201), 1, 'Exactly one concurrent cash reopen must succeed.');
  assert.equal(reopenResponses.filter((item) => [400, 409].includes(item.status)).length, 1);
  assert.equal(await prisma.cashSession.count({ where: { status: 'OPEN' } }), 1);
  const reopenedCash = reopenResponses.find((item) => item.status === 201).body;
  assert.equal(reopenedCash.reopenedFromSessionId, closedCash.id);
  const manualMovement = await post('/cash-register/movements/manual', {
    type: 'OTHER_INCOME', amount: 1200, classification: 'PHASE_2_5', description: 'Synthetic controlled income',
  }, cashierToken);
  results.cash = {
    concurrentClose: 'PASS', concurrentReopen: 'PASS', openSessions: 1,
    closingMovements: 1, manualMovementId: manualMovement.body.id,
  };

  // POS: create, receipt/reprint immutability, recovery and reopen exactly once.
  const sodaBeforeSale = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
  const sale = await timed('posCheckout', () => post('/sales', {
    items: [{ productId: soda.id, quantity: 1 }],
    payments: [{ paymentMethodId: cashMethod.id, amount: decimal(soda.salePrice) }],
  }, cashierToken));
  assert.equal(decimal(sale.body.total), decimal(soda.salePrice));
  const sodaAfterSale = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
  assert.equal(decimal(sodaAfterSale.currentStock), decimal(sodaBeforeSale.currentStock) - 1);

  const beforeReprint = await databaseFingerprint();
  const receiptOne = await timed('posReceiptGeneration', () => get(`/sales/${sale.body.id}/receipt-pdf`, adminToken));
  const receiptTwo = await get(`/sales/${sale.body.id}/receipt-pdf`, adminToken);
  assert.equal(receiptOne.body.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(await databaseFingerprint(), beforeReprint, 'Reprint must not mutate operational data.');
  const posPdf = await renderPdf('pos-receipt-real', receiptOne.body);
  const posPdfRepeat = await renderPdf('pos-receipt-real-repeat', receiptTwo.body);
  assert.equal(posPdfRepeat.text.replace(/\s+/g, ' ').trim(), posPdf.text.replace(/\s+/g, ' ').trim());
  assert.match(posPdf.text, /TOTAL/i);
  assert.doesNotMatch(posPdf.text, /CUENTA (ACTUALIZADA )?DE DOMICILIO/i);

  const conversionResponses = await timed('posConcurrentRecovery', () => Promise.all([
    post(`/sales/${sale.body.id}/convert-to-order`, {
      type: 'COUNTER', reason: 'Phase 2.5 controlled recovery A',
    }, adminToken, null),
    post(`/sales/${sale.body.id}/convert-to-order`, {
      type: 'COUNTER', reason: 'Phase 2.5 controlled recovery B',
    }, adminToken, null),
  ]));
  assert.equal(countStatus(conversionResponses, 201), 1, 'Recovery must apply exactly once.');
  assert.equal(conversionResponses.filter((item) => [400, 409].includes(item.status)).length, 1);
  const converted = conversionResponses.find((item) => item.status === 201).body;
  assert.equal(await prisma.saleConversion.count({ where: { saleId: sale.body.id } }), 1);
  assert.equal(await prisma.cashMovement.count({ where: { referenceType: 'sale_conversion', referenceId: sale.body.id } }), 1);
  const sodaAfterConversion = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
  assert.equal(decimal(sodaAfterConversion.currentStock), decimal(sodaBeforeSale.currentStock));

  const recoverySale = await post('/sales', {
    items: [{ productId: soda.id, quantity: 1 }],
    payments: [{ paymentMethodId: cashMethod.id, amount: decimal(soda.salePrice) }],
  }, adminToken);
  const recoveryConversion = await post(`/sales/${recoverySale.body.id}/convert-to-order`, {
    type: 'COUNTER', reason: 'Phase 2.5 reopen preparation',
  }, adminToken);
  const recoveredOrderId = recoveryConversion.body.orderTicket.id;
  await post(`/orders/${recoveredOrderId}/checkout`, {
    payments: [{ paymentMethodId: cashMethod.id, amount: decimal(soda.salePrice) }],
  }, adminToken);
  const reopenOrderResponses = await timed('posConcurrentReopen', () => Promise.all([
    post(`/sales/${recoverySale.body.id}/reopen-converted-order`, { reason: 'Phase 2.5 order reopen A' }, adminToken, null),
    post(`/sales/${recoverySale.body.id}/reopen-converted-order`, { reason: 'Phase 2.5 order reopen B' }, adminToken, null),
  ]));
  assert.equal(countStatus(reopenOrderResponses, 201), 1, 'Converted order reopen must apply exactly once.');
  assert.equal(reopenOrderResponses.filter((item) => [400, 409].includes(item.status)).length, 1);

  const directReopenStockBefore = decimal((await prisma.product.findUniqueOrThrow({ where: { id: soda.id } })).currentStock);
  const directOrder = await post('/orders', {
    type: 'COUNTER',
    customerName: 'Phase 2.5 direct reopen',
    items: [{ productId: soda.id, quantity: 1 }],
  }, adminToken);
  await post(`/orders/${directOrder.body.id}/checkout`, {
    payments: [{ paymentMethodId: cashMethod.id, amount: decimal(soda.salePrice) }],
  }, adminToken);
  const directReopenResponses = await timed('orderConcurrentReopen', () => Promise.all([
    post(`/orders/${directOrder.body.id}/reopen`, { reason: 'Phase 2.5 direct reopen A' }, adminToken, null),
    post(`/orders/${directOrder.body.id}/reopen`, { reason: 'Phase 2.5 direct reopen B' }, adminToken, null),
  ]));
  assert.equal(countStatus(directReopenResponses, 201), 1, 'Direct order reopen must apply exactly once.');
  assert.equal(directReopenResponses.filter((item) => [400, 409].includes(item.status)).length, 1);
  assert.equal(
    await prisma.cashMovement.count({ where: { referenceType: 'order_reopen', referenceId: directOrder.body.id } }),
    1,
  );
  assert.equal(
    decimal((await prisma.product.findUniqueOrThrow({ where: { id: soda.id } })).currentStock),
    directReopenStockBefore,
  );

  const failedSaleFingerprint = await databaseFingerprint();
  const failedSale = await post('/sales', {
    items: [{ productId: soda.id, quantity: 999999 }],
    payments: [{ paymentMethodId: cashMethod.id, amount: 1 }],
  }, cashierToken, null);
  assert.equal(failedSale.status, 400);
  assert.deepEqual(await databaseFingerprint(), failedSaleFingerprint);
  results.pos = {
    saleId: sale.body.id,
    checkout: 'PASS',
    receipt: {
      sha256: posPdf.sha256,
      repeatSha256: posPdfRepeat.sha256,
      contentDeterministic: true,
      binaryDeterministic: posPdf.sha256 === posPdfRepeat.sha256,
      noSideEffects: true,
    },
    recoveryExactlyOnce: 'PASS',
    reopenExactlyOnce: 'PASS',
    directOrderReopenExactlyOnce: 'PASS',
    insufficientStockRollback: 'PASS',
    recoveredOrderId: converted.orderTicket.id,
  };

  // Delivery: commercial versioning and logistics-only location through the real admin resolution endpoint.
  const delivery = await post('/orders', {
    type: 'DELIVERY',
    customerName: 'Phase 2.5 Synthetic Delivery',
    customerPhone: '573000002355',
    deliveryReference: 'Synthetic address Phase 2.5',
    deliveryFee: 9000,
    deliveryFeeEditReason: 'Phase 2.5 persisted test fee',
    items: [{ productId: burger.id, quantity: 1 }],
  }, adminToken);
  const initialStatus = await get(`/orders/${delivery.body.id}/delivery-receipt-status`, adminToken);
  const initialReceipt = await get(`/orders/${delivery.body.id}/delivery-receipt`, adminToken);
  const initialPdf = await renderPdf('delivery-initial-real', initialReceipt.body);
  for (const required of [/CUENTA DE DOMICILIO/i, /VERSI[ÓO]N\s+1/i, /VIGENTE/i, /Subtotal productos/i, /Tarifa de domicilio/i, /TOTAL A PAGAR/i]) {
    assert.match(initialPdf.normalizedText, required);
  }
  assert.doesNotMatch(initialPdf.normalizedText, /COMPROBANTE OPERATIVO POS/i);

  const deliveryFee = decimal(delivery.body.deliveryFee);
  const updatedDelivery = await timed('deliveryCommercialUpdate', () => put(`/orders/${delivery.body.id}/items`, {
    expectedRevision: delivery.body.revision,
    items: [
      { productId: burger.id, quantity: 1 },
      { productId: soda.id, quantity: 1 },
    ],
  }, adminToken));
  assert.equal(decimal(updatedDelivery.body.deliveryFee), deliveryFee);
  assert.ok(decimal(updatedDelivery.body.subtotal) > decimal(delivery.body.subtotal));
  const updatedStatus = await get(`/orders/${delivery.body.id}/delivery-receipt-status`, adminToken);
  assert.equal(updatedStatus.body.version, initialStatus.body.version + 1);
  const updatedReceipt = await get(`/orders/${delivery.body.id}/delivery-receipt`, adminToken);
  const updatedPdf = await renderPdf('delivery-updated-real', updatedReceipt.body);
  for (const required of [/CUENTA ACTUALIZADA DE DOMICILIO/i, /VERSI[ÓO]N\s+2/i, /VIGENTE/i, /Subtotal productos/i, /Tarifa de domicilio/i, /TOTAL A PAGAR/i, /reemplaza las versiones anteriores/i]) {
    assert.match(updatedPdf.normalizedText, required);
  }

  const noChange = await put(`/orders/${delivery.body.id}/items`, {
    expectedRevision: updatedDelivery.body.revision,
    items: [
      { productId: burger.id, quantity: 1 },
      { productId: soda.id, quantity: 1 },
    ],
  }, adminToken);
  assert.equal(noChange.body.revision, updatedDelivery.body.revision);
  assert.equal((await get(`/orders/${delivery.body.id}/delivery-receipt-status`, adminToken)).body.version, updatedStatus.body.version);

  const locationBefore = await prisma.orderTicket.findUniqueOrThrow({ where: { id: delivery.body.id } });
  const locationReceiptBefore = await get(`/orders/${delivery.body.id}/delivery-receipt-status`, adminToken);
  const inbox = await prisma.deliveryLocationInbox.create({
    data: {
      normalizedSenderPhone: '573000002355',
      latitude: 3.2601,
      longitude: -76.5401,
      matchStatus: 'REQUIRES_REVIEW',
      matchedRule: 'phase_2_5_synthetic',
    },
  });
  await post(`/orders/delivery-location-inbox/${inbox.id}/resolve`, {
    orderId: delivery.body.id, notes: 'Phase 2.5 logistics-only resolution',
  }, adminToken);
  const locationAfter = await prisma.orderTicket.findUniqueOrThrow({ where: { id: delivery.body.id } });
  assert.equal(decimal(locationAfter.deliveryFee), decimal(locationBefore.deliveryFee));
  assert.equal(decimal(locationAfter.subtotal), decimal(locationBefore.subtotal));
  assert.equal(JSON.stringify(locationAfter.deliveryPricingBreakdown), JSON.stringify(locationBefore.deliveryPricingBreakdown));
  assert.equal((await get(`/orders/${delivery.body.id}/delivery-receipt-status`, adminToken)).body.version, locationReceiptBefore.body.version);
  assert.equal(locationAfter.deliveryLocationSource, 'whatsapp_live_location');

  const concurrentDelivery = await post('/orders', {
    type: 'DELIVERY', customerName: 'Concurrent Synthetic Delivery', customerPhone: '573000002356',
    deliveryReference: 'Synthetic concurrent address', deliveryFee: 9000,
    deliveryFeeEditReason: 'Phase 2.5 concurrency fee', items: [{ productId: burger.id, quantity: 1 }],
  }, adminToken);
  const deliveryConcurrency = await timed('deliveryConcurrentUpdate', () => Promise.all([
    put(`/orders/${concurrentDelivery.body.id}/items`, {
      expectedRevision: concurrentDelivery.body.revision,
      items: [{ productId: burger.id, quantity: 1 }, { productId: soda.id, quantity: 1 }],
    }, adminToken, null),
    put(`/orders/${concurrentDelivery.body.id}/items`, {
      expectedRevision: concurrentDelivery.body.revision,
      items: [{ productId: burger.id, quantity: 2 }],
    }, adminToken, null),
  ]));
  assert.equal(countStatus(deliveryConcurrency, 200), 1, 'Only one stale-revision Delivery update may succeed.');
  assert.equal(deliveryConcurrency.filter((item) => [400, 409].includes(item.status)).length, 1);
  const deliveryHistory = await get(`/orders/${delivery.body.id}/delivery-receipt-history`, adminToken);
  assert.ok(Array.isArray(deliveryHistory.body.versions) && deliveryHistory.body.versions.length >= 2);
  assert.equal(deliveryHistory.body.currentVersion, updatedStatus.body.version);

  const catalog = await get('/admin/sofia/catalog', adminToken);
  const maxi = catalog.body.find((item) => item.slug === 'maxi-family');
  assert.equal(maxi?.composition?.requiredCopy, '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L');
  results.delivery = {
    orderId: delivery.body.id,
    feePersisted: deliveryFee,
    initialVersion: initialStatus.body.version,
    updatedVersion: updatedStatus.body.version,
    initialPdf: { sha256: initialPdf.sha256, bytes: initialPdf.bytes },
    updatedPdf: { sha256: updatedPdf.sha256, bytes: updatedPdf.bytes },
    noOpDidNotVersion: true,
    logisticsOnly: true,
    concurrency: 'PASS',
    maxyFamilyRule: 'PASS',
  };

  // Inventory: purchase, serialized adjustments, count and atomic failure.
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { isActive: true } });
  const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { code: 'PAN-HAMB' } });
  const ingredientBeforePurchase = decimal(ingredient.currentStock);
  const purchase = await timed('inventoryPurchase', () => post('/purchases', {
    supplierId: supplier.id,
    invoiceNumber: `E2E-${requiredEnv('EPHEMERAL_TEST_RUN_ID')}`,
    notes: 'Phase 2.5 synthetic purchase',
    paymentMethodId: cashMethod.id,
    items: [{ ingredientId: ingredient.id, quantity: 3, unitCost: 1100 }],
  }, inventoryToken));
  const ingredientAfterPurchase = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
  assert.equal(decimal(ingredientAfterPurchase.currentStock), ingredientBeforePurchase + 3);
  const purchaseMovement = await prisma.inventoryMovement.findFirstOrThrow({
    where: { ingredientId: ingredient.id, type: 'PURCHASE', referenceType: 'purchase' },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(decimal(purchaseMovement.balanceAfter), ingredientBeforePurchase + 3);

  const productBeforeAdjustments = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
  const adjustmentResponses = await timed('inventoryConcurrentAdjustments', () => Promise.all([
    post('/inventory/adjustments', {
      productId: soda.id, quantity: 1, reason: 'PHASE_2_5_CONCURRENT_A', movementType: 'ADJUSTMENT',
    }, inventoryToken, null),
    post('/inventory/adjustments', {
      productId: soda.id, quantity: 1, reason: 'PHASE_2_5_CONCURRENT_B', movementType: 'ADJUSTMENT',
    }, inventoryToken, null),
  ]));
  assert.equal(countStatus(adjustmentResponses, 201), 2);
  const productAfterAdjustments = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
  assert.equal(decimal(productAfterAdjustments.currentStock), decimal(productBeforeAdjustments.currentStock) + 2);

  const inventoryBeforeFailure = await databaseFingerprint();
  const negativeAdjustment = await post('/inventory/adjustments', {
    productId: soda.id, quantity: -999999, reason: 'PHASE_2_5_NEGATIVE_GUARD', movementType: 'ADJUSTMENT',
  }, inventoryToken, null);
  assert.equal(negativeAdjustment.status, 400);
  assert.deepEqual(await databaseFingerprint(), inventoryBeforeFailure);

  const countedStock = decimal(productAfterAdjustments.currentStock) + 1;
  const stockCount = await post('/inventory/stock-counts', {
    scope: 'PRODUCTS', notes: 'Phase 2.5 deterministic count',
    items: [{ itemType: 'PRODUCT', itemId: soda.id, countedStock, reason: 'Phase 2.5 count' }],
  }, inventoryToken);
  assert.equal(stockCount.body.status, 'COMPLETED');
  assert.equal(decimal((await prisma.product.findUniqueOrThrow({ where: { id: soda.id } })).currentStock), countedStock);
  results.inventory = {
    purchaseId: purchase.body.id,
    purchaseStockIncrement: 3,
    purchaseMovementId: purchaseMovement.id,
    concurrentAdjustments: 'PASS',
    negativeStockGuard: 'PASS',
    stockCount: 'PASS',
  };

  // RBAC checks use real guards and verify denied operations leave no state changes.
  const rbacBefore = await databaseFingerprint();
  const denied = await Promise.all([
    post('/cash-register/reopen', { reason: 'Unauthorized Phase 2.5 attempt' }, cashierToken, null),
    post('/inventory/adjustments', { productId: soda.id, quantity: 1, reason: 'UNAUTHORIZED' }, noAccessToken, null),
    post('/purchases', { supplierId: supplier.id, items: [{ ingredientId: ingredient.id, quantity: 1, unitCost: 1 }] }, cashierToken, null),
    get('/admin/sofia/metrics/summary', cashierToken, null),
  ]);
  const unauthenticated = await get('/audit?limit=1', undefined, null);
  assert.deepEqual(denied.map((item) => item.status), [403, 403, 403, 403]);
  assert.equal(unauthenticated.status, 401);
  const rbacAfter = await databaseFingerprint();
  assert.deepEqual({ ...rbacAfter, audits: rbacBefore.audits }, rbacBefore);
  assert.equal(rbacAfter.audits, rbacBefore.audits + 5, 'Each denied request must persist one audit event.');
  results.rbac = { denied: 5, operationalSideEffects: 0, persistedRejections: 5, status: 'PASS' };

  const auditActions = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityId: sale.body.id },
        { entityId: delivery.body.id },
        { entityId: purchase.body.id },
        { entityId: manualMovement.body.id },
        { entityId: reopenedCash.id },
      ],
    },
    select: {
      action: true, module: true, entity: true, entityId: true, userId: true,
      eventVersion: true, timestamp: true, actorId: true, actorRole: true,
      requestId: true, correlationId: true, traceId: true, idempotencyKey: true,
      before: true, after: true, result: true, reasonCode: true, metadata: true,
      oldValues: true, newValues: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const requiredAction of ['CREATE', 'REOPEN', 'CREATE_MANUAL_MOVEMENT', 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED', 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY']) {
    assert.ok(auditActions.some((item) => item.action === requiredAction), `Missing audit action ${requiredAction}.`);
  }
  const contractActions = auditActions.filter((item) => [
    'CREATE', 'REOPEN', 'CREATE_MANUAL_MOVEMENT',
    'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED', 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
  ].includes(item.action));
  for (const event of contractActions) {
    assert.equal(event.eventVersion, 2);
    assert.ok(event.actorId, `Missing actorId for ${event.action}.`);
    assert.ok(event.actorRole, `Missing actorRole for ${event.action}.`);
    assert.ok(event.requestId, `Missing requestId for ${event.action}.`);
    assert.ok(event.correlationId, `Missing correlationId for ${event.action}.`);
    assert.match(event.traceId ?? '', /^[a-f0-9]{32}$/);
    assert.ok(event.idempotencyKey, `Missing idempotencyKey for ${event.action}.`);
    assert.ok(event.before !== null || event.after !== null, `Missing before/after for ${event.action}.`);
    assert.ok(['SUCCESS', 'BLOCKED', 'REJECTED', 'CONFLICT', 'NO_OP'].includes(event.result));
    assert.ok(event.reasonCode, `Missing reasonCode for ${event.action}.`);
    assert.ok(event.timestamp instanceof Date);
  }
  const deniedAudits = await prisma.auditLog.findMany({
    where: { module: 'security', action: 'RBAC_DENIED', requestId: { in: denied.map((item) => item.auditContext.requestId) } },
  });
  assert.equal(deniedAudits.length, 4);
  assert.ok(deniedAudits.every((item) => item.eventVersion === 2 && item.result === 'REJECTED' && item.actorRole));
  const authenticationDenied = await prisma.auditLog.findFirstOrThrow({
    where: { module: 'security', action: 'AUTHENTICATION_DENIED', requestId: unauthenticated.auditContext.requestId },
  });
  assert.equal(authenticationDenied.actorId, null);
  assert.equal(authenticationDenied.actorRole, 'unauthenticated');
  assert.equal(authenticationDenied.reasonCode, 'AUTHENTICATION_REQUIRED');
  assert.ok(requestIds.size >= 10, 'Request correlation headers must be present.');
  results.audit = {
    entries: auditActions.length,
    requestIdsObserved: requestIds.size,
    persistedFields: [
      'eventVersion', 'actorId', 'actorRole', 'requestId', 'correlationId', 'traceId',
      'idempotencyKey', 'before', 'after', 'result', 'reasonCode', 'timestamp',
    ],
    rbacRejections: deniedAudits.length,
    authenticationRejections: 1,
    status: 'PASS',
  };

  const legacyAudit = await prisma.auditLog.create({
    data: {
      action: 'LEGACY_COMPATIBILITY_PROBE',
      module: 'audit-test',
      entity: 'legacy_probe',
      entityId: 'synthetic-legacy',
      newValues: { synthetic: true },
    },
  });
  const auditQuery = await get('/audit?module=audit-test&action=LEGACY_COMPATIBILITY_PROBE&limit=10', adminToken);
  const legacyView = auditQuery.body.data.find((item) => item.id === legacyAudit.id);
  assert.equal(legacyView?.eventVersion, 1);
  assert.equal(legacyView?.legacy, true);
  assert.equal(legacyView?.contextAvailable, false);
  assert.equal(legacyView?.requestId, null);
  const deniedAuditQuery = await get('/audit?limit=1', noAccessToken, null);
  assert.equal(deniedAuditQuery.status, 403);
  results.audit.queryApi = 'PASS';
  results.audit.legacyCompatibility = 'PASS';

  const finalState = await databaseFingerprint();
  const reconciliation = {
    status: 'PASS',
    baseline,
    final: finalState,
    cash: {
      openSessions: await prisma.cashSession.count({ where: { status: 'OPEN' } }),
      conversionReversals: await prisma.cashMovement.count({ where: { referenceType: 'sale_conversion' } }),
    },
    pos: {
      saleItemsTotal: decimal((await prisma.saleItem.aggregate({ _sum: { totalPrice: true } }))._sum.totalPrice),
      paidSalesTotal: decimal((await prisma.sale.aggregate({ where: { status: 'PAID' }, _sum: { total: true } }))._sum.total),
    },
    delivery: {
      activeVersions: updatedStatus.body.version,
      persistedFee: decimal(locationAfter.deliveryFee),
      persistedTotal: decimal(locationAfter.subtotal),
    },
    inventory: {
      productStock: decimal((await prisma.product.findUniqueOrThrow({ where: { id: soda.id } })).currentStock),
      movements: await prisma.inventoryMovement.count(),
    },
    operationalDatabaseTouched: false,
    productionModified: false,
    realWhatsapp: 'OFF',
  };
  assert.equal(reconciliation.cash.openSessions, 1);
  await writeJson('core-reconciliation.json', reconciliation);
  await writeJson('core-operational-results.json', { status: 'PASS', ...results });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...results })}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
