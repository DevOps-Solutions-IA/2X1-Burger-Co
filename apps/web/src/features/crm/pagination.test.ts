import assert from 'node:assert/strict';
import test from 'node:test';
import { clampCrmPage } from './pagination-model';

test('clampCrmPage keeps a valid page unchanged', () => {
  assert.equal(clampCrmPage(3, 8), 3);
});

test('clampCrmPage resets invalid and empty-result pages safely', () => {
  assert.equal(clampCrmPage(0, 8), 1);
  assert.equal(clampCrmPage(Number.NaN, 8), 1);
  assert.equal(clampCrmPage(4, 0), 1);
});

test('clampCrmPage moves a stale page to the last available page', () => {
  assert.equal(clampCrmPage(9, 4), 4);
});
