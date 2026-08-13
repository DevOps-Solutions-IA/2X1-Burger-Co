import assert from 'node:assert/strict';
import test from 'node:test';
import { getCatalogWindow, WAITER_CATALOG_PAGE_SIZE } from './catalog-window';

test('bounds the initial waiter catalog window', () => {
  const catalog = Array.from({ length: 40 }, (_, index) => index);
  const result = getCatalogWindow(catalog, WAITER_CATALOG_PAGE_SIZE);

  assert.equal(result.items.length, 12);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextVisibleCount, 24);
});

test('never renders beyond the catalog and closes pagination', () => {
  const catalog = Array.from({ length: 14 }, (_, index) => index);
  const result = getCatalogWindow(catalog, 24);

  assert.deepEqual(result.items, catalog);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextVisibleCount, 14);
});
