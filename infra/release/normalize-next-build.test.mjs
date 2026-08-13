import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const normalizer = path.resolve(import.meta.dirname, 'normalize-next-build.mjs');
const releaseEnv = { ...process.env, RELEASE_REPRODUCIBILITY_SECRET: 'a'.repeat(64) };

test('normalizes Next manifests without changing transactional runtime facts', () => {
  const { root } = fixture({ node: {}, edge: {}, encryptionKey: 'synthetic-stable-key' });
  execFileSync('node', [normalizer, root], { env: releaseEnv });
  const prerender = JSON.parse(readFileSync(path.join(root, 'prerender-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(prerender.routes), ['/a', '/b']);
  assert.match(prerender.preview.previewModeId, /^[a-f0-9]{32}$/);
  assert.match(prerender.preview.previewModeSigningKey, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path.join(root, 'server/pages-manifest.json'), 'utf8'), '{"/404":"pages/404.html","/_app":"pages/_app.js","/_document":"pages/_document.js","/_error":"pages/_error.js"}');
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.json'), 'utf8'), '{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}');
  assert.equal(readFileSync(path.join(root, 'server/next-font-manifest.js'), 'utf8'), 'self.__NEXT_FONT_MANIFEST=\'{"app":{"/layout":["a.woff2","z.woff2"]},"pages":{}}\';');
  assert.equal(readFileSync(path.join(root, 'server/app/demo/page_client-reference-manifest.js'), 'utf8'), 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/demo/page"]={"a":{"value":1},"z":{"value":2}}');
});

test('rejects deterministic release-key normalization when Server Actions exist', () => {
  const { root } = fixture({ node: { action: {} }, edge: {}, encryptionKey: 'synthetic-stable-key' });
  const result = spawnSync('node', [normalizer, root], { env: releaseEnv });
  assert.notEqual(result.status, 0);
});

test('rejects preview normalization when Edge middleware or functions exist', () => {
  const { root } = fixture({ node: {}, edge: {} });
  writeFileSync(path.join(root, 'server/middleware-manifest.json'), JSON.stringify({ middleware: { '/': {} }, functions: {} }));
  const result = spawnSync('node', [normalizer, root], { env: releaseEnv });
  assert.notEqual(result.status, 0);
});

test('rejects a missing or weak reproducibility secret', () => {
  const { root } = fixture({ node: {}, edge: {} });
  const result = spawnSync('node', [normalizer, root], { env: { ...process.env, RELEASE_REPRODUCIBILITY_SECRET: 'public-build-id' } });
  assert.notEqual(result.status, 0);
});

test('preview credentials are stable for one release secret and change with independent entropy', () => {
  const first = fixture({ node: {}, edge: {} });
  const second = fixture({ node: {}, edge: {} });
  const third = fixture({ node: {}, edge: {} });
  execFileSync('node', [normalizer, first.root], { env: releaseEnv });
  execFileSync('node', [normalizer, second.root], { env: releaseEnv });
  execFileSync('node', [normalizer, third.root], { env: { ...process.env, RELEASE_REPRODUCIBILITY_SECRET: 'b'.repeat(64) } });
  const preview = ({ root }) => JSON.parse(readFileSync(path.join(root, 'prerender-manifest.json'), 'utf8')).preview;
  assert.deepEqual(preview(second), preview(first));
  assert.notDeepEqual(preview(third), preview(first));
});

test('pages manifest normalization is stable across concurrent insertion order', () => {
  const first = fixture({ node: {}, edge: {} });
  const second = fixture({ node: {}, edge: {} });
  writeFileSync(path.join(second.root, 'server/pages-manifest.json'), JSON.stringify({
    '/404': 'pages/404.html',
    '/_document': 'pages/_document.js',
    '/_error': 'pages/_error.js',
    '/_app': 'pages/_app.js',
  }));

  execFileSync('node', [normalizer, first.root], { env: releaseEnv });
  execFileSync('node', [normalizer, second.root], { env: releaseEnv });

  assert.equal(
    readFileSync(path.join(second.root, 'server/pages-manifest.json'), 'utf8'),
    readFileSync(path.join(first.root, 'server/pages-manifest.json'), 'utf8'),
  );
});

function fixture(references) {
  const root = mkdtempSync(path.join(tmpdir(), 'next-build-normalize-'));
  mkdirSync(path.join(root, 'server/app/demo'), { recursive: true });
  writeFileSync(path.join(root, 'app-build-manifest.json'), JSON.stringify({ pages: { '/b': [], '/a': [] } }));
  writeFileSync(path.join(root, 'app-path-routes-manifest.json'), JSON.stringify({ '/b/page': '/b', '/a/page': '/a' }));
  writeFileSync(path.join(root, 'server/app-paths-manifest.json'), JSON.stringify({ '/b/page': 'b.js', '/a/page': 'a.js' }));
  writeFileSync(path.join(root, 'server/pages-manifest.json'), JSON.stringify({ '/_app': 'pages/_app.js', '/_error': 'pages/_error.js', '/_document': 'pages/_document.js', '/404': 'pages/404.html' }));
  writeFileSync(path.join(root, 'prerender-manifest.json'), JSON.stringify({ version: 4, preview: { previewModeId: 'random', previewModeSigningKey: 'random', previewModeEncryptionKey: 'random' }, routes: { '/b': { value: 2 }, '/a': { value: 1 } } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.json'), JSON.stringify({ pages: {}, app: { '/layout': ['z.woff2', 'a.woff2'] } }));
  writeFileSync(path.join(root, 'server/next-font-manifest.js'), 'variable');
  writeFileSync(path.join(root, 'server/server-reference-manifest.json'), JSON.stringify(references));
  writeFileSync(path.join(root, 'server/middleware-manifest.json'), JSON.stringify({ middleware: {}, functions: {} }));
  writeFileSync(path.join(root, 'server/functions-config-manifest.json'), JSON.stringify({ functions: {} }));
  writeFileSync(path.join(root, 'server/app/demo/page_client-reference-manifest.js'), 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/demo/page"]={"z":{"value":2},"a":{"value":1}}');
  return { root };
}
