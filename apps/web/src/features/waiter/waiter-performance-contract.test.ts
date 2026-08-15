import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const featureDirectory = fileURLToPath(new URL('.', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Module-relative test fixture.
const pageSource = readFileSync(
  new URL('../../app/(waiter)/waiter/page.client.tsx', import.meta.url),
  'utf8',
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Module-relative test fixture.
const composerSource = readFileSync(`${featureDirectory}/waiter-composer-surface.tsx`, 'utf8');

test('mounts the composer only for an explicit table context', () => {
  assert.match(pageSource, /viewMode === 'compose' && selectedTable/);
  assert.match(pageSource, /enabled: viewMode === 'compose' && Boolean\(selectedTableId\)/);
  assert.doesNotMatch(pageSource, /composeFilteredProducts\.map/);
});

test('stops polling while the waiter application is hidden', () => {
  const visibilityBoundIntervals = pageSource.match(
    /refetchInterval: isDocumentVisible \? \d+ : false/g,
  );

  assert.equal(visibilityBoundIntervals?.length, 4);
  assert.doesNotMatch(pageSource, /refetchInterval:\s*\d+/);
});

test('renders the catalog through the bounded window', () => {
  assert.match(composerSource, /getCatalogWindow\(products, visibleProductCount\)/);
  assert.match(composerSource, /productWindow\.items\.map/);
  assert.match(composerSource, /productWindow\.hasMore/);
  assert.doesNotMatch(composerSource, /products\.map/);
});
