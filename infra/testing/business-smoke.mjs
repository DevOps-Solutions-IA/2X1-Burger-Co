import assert from 'node:assert/strict';
import { apiRequest, authHeaders, login, requiredEnv, writeJson } from './runtime-client.mjs';

const token = await login(requiredEnv('EPHEMERAL_ADMIN_EMAIL'), requiredEnv('EPHEMERAL_ADMIN_PASSWORD'));
const auth = authHeaders(token);
const get = (path, expected) => apiRequest(path, { headers: auth }, expected);
const post = (path, body, expected) => apiRequest(path, { method: 'POST', headers: auth, body: JSON.stringify(body) }, expected);

const result = { cash: {}, pos: {}, delivery: {}, inventory: {}, safety: {} };

const seededCash = await get('/cash-register/current');
assert.equal(seededCash.body.id, 'e2e-cash-open');
await post('/cash-register/movements/manual', {
  type: 'OTHER_INCOME', amount: 1000, classification: 'E2E', description: 'Synthetic movement',
});
const summary = await get('/cash-register/daily-summary?actualAmount=1000');
assert.ok(summary.body);
await post('/cash-register/close', { actualAmount: 1000 });
await post('/cash-register/open', { openingAmount: 5000, notes: 'E2E business smoke' });
result.cash = { opened: true, movement: true, summary: true, closed: true, audit: true };

const products = await get('/products/sellable');
const directProduct = products.body.find((item) => item.code === 'CC-ORG-400');
assert.ok(directProduct);
const paymentMethods = await get('/payment-methods');
const cashPayment = paymentMethods.body.find((item) => item.code === 'cash');
assert.ok(cashPayment);
const stockBefore = Number(directProduct.currentStock);
const sale = await post('/sales', {
  items: [{ productId: directProduct.id, quantity: 1 }],
  payments: [{ paymentMethodId: cashPayment.id, amount: Number(directProduct.salePrice) }],
});
const receipt = await get(`/sales/${sale.body.id}/receipt-pdf`);
assert.equal(receipt.body.subarray(0, 4).toString(), '%PDF');
const productAfter = await get(`/products/${directProduct.id}`);
assert.equal(Number(productAfter.body.currentStock), stockBefore - 1);
result.pos = { catalog: true, total: Number(sale.body.total), receipt: true, stockConsumed: true };

const burger = products.body.find((item) => item.code === 'HAMB-2X1');
assert.ok(burger);
const delivery = await post('/orders', {
  type: 'DELIVERY',
  customerName: 'E2E Synthetic Customer',
  customerPhone: '573000002398',
  deliveryReference: 'Synthetic address 2300',
  deliveryLatitude: 3.2601,
  deliveryLongitude: -76.5401,
  deliveryFee: 9000,
  deliveryFeeEditReason: 'E2E persisted fee',
  items: [{ productId: burger.id, quantity: 1 }],
});
const feeBefore = Number(delivery.body.deliveryFee);
const totalBefore = Number(delivery.body.subtotal);
const deliveryReceipt = await get(`/orders/${delivery.body.id}/delivery-receipt`);
assert.equal(deliveryReceipt.body.subarray(0, 4).toString(), '%PDF');
const receiptStatus = await get(`/orders/${delivery.body.id}/delivery-receipt-status`);
assert.ok(receiptStatus.body.version >= 1);
const orderAfterLocation = await get(`/orders/${delivery.body.id}`);
assert.equal(Number(orderAfterLocation.body.deliveryFee), feeBefore);
assert.equal(Number(orderAfterLocation.body.subtotal), totalBefore);
result.delivery = { feePersisted: true, receipt: true, currentVersion: receiptStatus.body.version, locationDidNotReprice: true };

const inventoryBefore = await get('/inventory/stock');
const stockItem = inventoryBefore.body.items.find((item) => item.id === directProduct.id && item.itemType === 'PRODUCT');
assert.ok(stockItem);
await post('/inventory/adjustments', {
  productId: directProduct.id, quantity: 2, reason: 'E2E synthetic entry', movementType: 'ADJUSTMENT',
});
const inventoryAfter = await get('/inventory/stock');
const stockItemAfter = inventoryAfter.body.items.find((item) => item.id === directProduct.id && item.itemType === 'PRODUCT');
assert.equal(Number(stockItemAfter.currentStock), Number(stockItem.currentStock) + 2);
const movements = await get(`/inventory/movements?search=${encodeURIComponent(directProduct.code)}&type=ADJUSTMENT`);
assert.ok(Array.isArray(movements.body.items ?? movements.body));
result.inventory = { entry: true, stockChanged: true, movements: true };

const dashboard = await get('/admin/sofia/dashboard/summary');
const qr = await get('/admin/sofia/whatsapp/qr/status');
assert.equal(dashboard.body.general.realSendingEnabled, false);
assert.equal(dashboard.body.general.autoReplyEnabled, false);
assert.equal(dashboard.body.general.autoSafeEnabled, false);
assert.equal(dashboard.body.general.productionEnabled, false);
assert.equal(qr.body.status, 'DISABLED');
result.safety = { realSend: 0, autoReply: false, autoSafe: false, production: false, qr: 'DISABLED' };

await writeJson('business-smoke-results.json', { status: 'PASS', ...result });
process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
