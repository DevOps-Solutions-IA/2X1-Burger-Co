import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const normalizer = path.resolve(import.meta.dirname, 'normalize-next-build.mjs');

test('normalizes Next manifests without changing transactional runtime facts', () => {
  const { root, sourceRoot } = fixture({ node: {}, edge: {}, encryptionKey: 'synthetic-stable-key' });
  execFileSync('node', [normalizer, root, sourceRoot], { env: { ...process.env, RELEASE_BUILD_ID: 'release-1' } });
  const prerender = JSON.parse(readFileSync(path.join(root, 'prerender-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(prerender.routes), ['/a', '/b']);
  assert.match(prerender.preview.previewModeId, /^[a-f0-9]{32}$/);
  assert.match(prerender.preview.previewModeSigningKey, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.json'), 'utf8'), '{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}');
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.js'), 'utf8'), 'self.__NEXT_FONT_MANIFEST=\'{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}\';');
  assert.equal(readFileSync(path.join(root, 'server/app/demo/page_client-reference-manifest.js'), 'utf8'), 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/demo/page"]={"a":{"value":1},"z":{"value":2}}');
});

test('rejects deterministic release-key normalization when Server Actions exist', () => {
  const { root, sourceRoot } = fixture({ node: { action: {} }, edge: {}, encryptionKey: 'synthetic-stable-key' });
  const result = spawnSync('node', [normalizer, root, sourceRoot], { env: { ...process.env, RELEASE_BUILD_ID: 'release-1' } });
  assert.notEqual(result.status, 0);
});

test('rejects deterministic preview keys when Draft Mode is used', () => {
  const { root, sourceRoot } = fixture({ node: {}, edge: {} });
  writeFileSync(path.join(sourceRoot, 'page.tsx'), 'export async function Page() { return draftMode(); }');
  const result = spawnSync('node', [normalizer, root, sourceRoot], { env: { ...process.env, RELEASE_BUILD_ID: 'release-1' } });
  assert.notEqual(result.status, 0);
});

function fixture(references) {
  const root = mkdtempSync(path.join(tmpdir(), 'next-build-normalize-'));
  const sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(root, 'server/app/demo'), { recursive: true });
  mkdirSync(sourceRoot);
  writeFileSync(path.join(root, 'app-build-manifest.json'), JSON.stringify({ pages: { '/b': [], '/a': [] } }));
  writeFileSync(path.join(root, 'app-path-routes-manifest.json'), JSON.stringify({ '/b/page': '/b', '/a/page': '/a' }));
  writeFileSync(path.join(root, 'server/app-paths-manifest.json'), JSON.stringify({ '/b/page': 'b.js', '/a/page': 'a.js' }));
  writeFileSync(path.join(root, 'prerender-manifest.json'), JSON.stringify({ version: 4, preview: { previewModeId: 'random', previewModeSigningKey: 'random', previewModeEncryptionKey: 'random' }, routes: { '/b': { value: 2 }, '/a': { value: 1 } } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.json'), JSON.stringify({ pages: {}, app: { '/layout': ['z.woff2', 'a.woff2'] } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.js'), 'variable');
  writeFileSync(path.join(root, 'server/server-reference-manifest.json'), JSON.stringify(references));
  writeFileSync(path.join(root, 'server/app/demo/page_client-reference-manifest.js'), 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/demo/page"]={"z":{"value":2},"a":{"value":1}}');
  return { root, sourceRoot };
}
