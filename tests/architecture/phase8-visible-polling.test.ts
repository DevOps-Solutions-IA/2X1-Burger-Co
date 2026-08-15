import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('POS and tables suspend polling when the operator tab is hidden', () => {
  const sources = [
    read('apps/web/src/app/(app)/pos/page.tsx'),
    read('apps/web/src/app/(app)/tables/page.tsx'),
  ];

  for (const source of sources) {
    assert.match(source, /refetchInterval: visiblePolling\(4_000\)/);
    assert.match(source, /refetchIntervalInBackground: false/);
    assert.doesNotMatch(source, /refetchInterval: 4000/);
  }
});
