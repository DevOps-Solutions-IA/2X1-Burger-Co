import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const normalizer = path.resolve(import.meta.dirname, 'normalize-next-build.mjs');

test('normalizes Next manifests without changing transactional runtime facts', () => {
  const root = fixture({ node: {}, edge: {}, encryptionKey: 'synthetic-stable-key' });
  execFileSync('node', [normalizer, root]);
  assert.equal(readFileSync(path.join(root, 'prerender-manifest.json'), 'utf8'), '{"routes":{"/a":{"value":1},"/b":{"value":2}},"version":4}');
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.json'), 'utf8'), '{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}');
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.js'), 'utf8'), 'self.__NEXT_FONT_MANIFEST=\'{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}\';');
});

test('rejects deterministic release-key normalization when Server Actions exist', () => {
  const root = fixture({ node: { action: {} }, edge: {}, encryptionKey: 'synthetic-stable-key' });
  const result = spawnSync('node', [normalizer, root]);
  assert.notEqual(result.status, 0);
});

function fixture(references) {
  const root = mkdtempSync(path.join(tmpdir(), 'next-build-normalize-'));
  mkdirSync(path.join(root, 'server'));
  writeFileSync(path.join(root, 'prerender-manifest.json'), JSON.stringify({ version: 4, routes: { '/b': { value: 2 }, '/a': { value: 1 } } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.json'), JSON.stringify({ pages: {}, app: { '/layout': ['z.woff2', 'a.woff2'] } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.js'), 'variable');
  writeFileSync(path.join(root, 'server/server-reference-manifest.json'), JSON.stringify(references));
  return root;
}
