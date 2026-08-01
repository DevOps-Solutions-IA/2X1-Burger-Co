import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkInternalApiHealth } from '../docker/web-healthcheck.mjs';
import { validateInternalApiUrl } from '../docker/web-runtime-url.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('accepts the verified split-container API service endpoint', () => {
  assert.equal(validateInternalApiUrl('http://api:3000'), 'http://api:3000');
});

test('rejects localhost, malformed, credentialed, and missing internal URLs', () => {
  for (const value of [undefined, '', 'localhost:3001', 'http://localhost:3001', 'http://api', 'http://u:p@api:3000']) {
    assert.throws(() => validateInternalApiUrl(value), /WEB_INTERNAL_API_URL_/u);
  }
});

test('healthy API readiness produces a healthy web dependency result', async () => {
  let requested;
  await assert.doesNotReject(() => checkInternalApiHealth('http://api:3000', async (url) => {
    requested = url;
    return { ok: true };
  }));
  assert.equal(requested, 'http://api:3000/health/ready');
});

test('API outage or unhealthy readiness makes the web dependency unhealthy', async () => {
  await assert.rejects(
    () => checkInternalApiHealth('http://api:3000', async () => { throw new Error('offline'); }),
    /WEB_INTERNAL_API_UNAVAILABLE/u,
  );
  await assert.rejects(
    () => checkInternalApiHealth('http://api:3000', async () => ({ ok: false })),
    /WEB_INTERNAL_API_UNHEALTHY/u,
  );
});

test('production and canary compose use the validated API service endpoint and image healthcheck', () => {
  for (const relative of ['docker-compose.yml', 'infra/release/docker-compose.canary.yml']) {
    const source = readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /INTERNAL_API_URL:\s+http:\/\/api:3000/u);
    assert.match(source, /\/app\/web-healthcheck\.mjs/u);
    assert.doesNotMatch(source, /wget -qO- http:\/\/localhost:3001\/login/u);
  }
});

test('isolated web runtimes use their verified internal API service endpoints', () => {
  for (const [relative, endpoint] of [
    ['infra/recovery/docker-compose.recovery.yml', 'restore-api'],
    ['infra/testing/docker-compose.ephemeral.yml', 'ephemeral-api'],
  ]) {
    const source = readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, new RegExp(`INTERNAL_API_URL:\\s+http:\\/\\/${endpoint}:3000`, 'u'));
    assert.doesNotMatch(source, /INTERNAL_API_URL:\s+http:\/\/localhost:/u);
    assert.doesNotMatch(source, /wget -qO- http:\/\/localhost:3001\/login/u);
  }
});
