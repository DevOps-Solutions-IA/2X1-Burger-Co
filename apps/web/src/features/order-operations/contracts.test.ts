import assert from 'node:assert/strict';
import test from 'node:test';
import { kitchenQueuePageSchema, orderDetailSchema } from './contracts';

function kitchenQueue(modifiersSnapshot: unknown) {
  return {
    items: [{
      id: 'order-1',
      number: '1042',
      revision: 3,
      status: 'OPEN',
      type: 'TAKEAWAY',
      customerName: 'Cliente controlado',
      notes: null,
      openedAt: '2026-08-13T12:00:00.000Z',
      updatedAt: '2026-08-13T12:01:00.000Z',
      items: [{
        id: 'item-1',
        productId: 'product-1',
        quantity: 2,
        notes: null,
        modifiersSnapshot,
        product: { name: 'Combo 2x1', code: '2X1' },
      }],
      orderCheckout: null,
    }],
    page: 1,
    limit: 100,
    total: 1,
  };
}

test('accepts an explicit empty modifiers snapshot as verified no-modifier evidence', () => {
  const result = kitchenQueuePageSchema.safeParse(kitchenQueue([]));

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.items[0]?.items[0]?.modifiersSnapshot, []);
});

test('preserves structured modifier evidence for kitchen rendering', () => {
  const modifiers = [
    { kind: 'REMOVE', ingredient: 'cebolla', quantity: null },
    { kind: 'ADD', optionName: 'tocineta', price: 5_000 },
  ];
  const result = kitchenQueuePageSchema.safeParse(kitchenQueue(modifiers));

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.items[0]?.items[0]?.modifiersSnapshot, modifiers);
});

test('rejects malformed modifier evidence instead of converting it to an empty snapshot', () => {
  for (const malformed of [null, 'sin cebolla', { kind: 'REMOVE' }, [null], ['REMOVE']]) {
    assert.equal(
      kitchenQueuePageSchema.safeParse(kitchenQueue(malformed)).success,
      false,
      `expected malformed snapshot ${JSON.stringify(malformed)} to fail`,
    );
  }
});

test('rejects missing modifier evidence so kitchen transitions cannot use an unverifiable item', () => {
  const payload = kitchenQueue([]);
  delete (payload.items[0]?.items[0] as { modifiersSnapshot?: unknown }).modifiersSnapshot;

  assert.equal(kitchenQueuePageSchema.safeParse(payload).success, false);
});

test('order detail also fails closed on malformed modifier evidence', () => {
  const item = {
    id: 'item-1',
    productId: 'product-1',
    quantity: 1,
    unitPrice: 25_000,
    totalPrice: 25_000,
    notes: null,
    modifiersSnapshot: 'sin cebolla',
    product: { name: 'Combo 2x1', code: '2X1', category: null },
  };

  assert.equal(orderDetailSchema.shape.items.safeParse([item]).success, false);
  assert.equal(orderDetailSchema.shape.items.safeParse([{ ...item, modifiersSnapshot: [] }]).success, true);
});
