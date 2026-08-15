import assert from 'node:assert/strict';
import test from 'node:test';
import { operationalSearchBody } from './queries';

test('places sensitive operational search text in the request body, not a URL parameter', () => {
  const body = operationalSearchBody({
    page: 2,
    limit: 25,
    q: '+573001234567',
    activeOnly: true,
  });

  assert.deepEqual(body, {
    page: 2,
    limit: 25,
    q: '+573001234567',
    activeOnly: 'true',
  });
});
