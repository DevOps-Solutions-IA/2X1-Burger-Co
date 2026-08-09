import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const generator = path.resolve(import.meta.dirname, 'generate-image-sbom.mjs');

test('installed-runtime SBOM is deterministic and scoped to the image root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-sbom-'));
  mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ name: '@scope/example', version: '1.2.3' }));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'runtime-app', version: '4.5.6' }));
  const first = execFileSync('node', [generator, 'api', 'a'.repeat(40), root], { encoding: 'utf8' });
  const second = execFileSync('node', [generator, 'api', 'a'.repeat(40), root], { encoding: 'utf8' });
  assert.equal(second, first);
  const sbom = JSON.parse(first);
  assert.equal(sbom.metadata.properties.find((entry) => entry.name === 'inventory:source').value, 'installed-runtime');
  assert.ok(sbom.components.some((entry) => entry.name === '@scope/example' && entry.version === '1.2.3'));
  assert.ok(sbom.components.some((entry) => entry.name === 'runtime-app' && entry.version === '4.5.6'));
});
