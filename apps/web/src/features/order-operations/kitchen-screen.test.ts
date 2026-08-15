import assert from 'node:assert/strict';
import test from 'node:test';
import type { KitchenQueuePage } from './contracts';
import { operableKitchenItems } from './kitchen-screen';

const retainedQueue = {
  items: [{ id: 'order-1' }],
  page: 1,
  limit: 100,
  total: 1,
} as KitchenQueuePage;

test('blocks every retained kitchen transition target while queue evidence is in error', () => {
  assert.deepEqual(operableKitchenItems(retainedQueue, true), []);
});

test('keeps verified kitchen orders operable when the query has no contract error', () => {
  assert.equal(operableKitchenItems(retainedQueue, false), retainedQueue.items);
});
