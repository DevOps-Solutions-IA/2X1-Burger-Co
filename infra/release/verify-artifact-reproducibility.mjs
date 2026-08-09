import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [firstPath, secondPath] = process.argv.slice(2);
if (!firstPath || !secondPath) {
  throw new Error('Usage: verify-artifact-reproducibility.mjs <first-record> <second-record>');
}

const first = JSON.parse(readFileSync(firstPath, 'utf8'));
const second = JSON.parse(readFileSync(secondPath, 'utf8'));
assert.deepEqual(second.manifest, first.manifest, 'release manifests differ across clean builds');
assert.match(first.api.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(second.api.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(first.web.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(second.web.digest, /^sha256:[a-f0-9]{64}$/);
assert.notEqual(second.api.tag, first.api.tag, 'API reproduction reused the original tag');
assert.notEqual(second.web.tag, first.web.tag, 'Web reproduction reused the original tag');
assert.equal(second.api.contentDigest, first.api.contentDigest, 'API runtime filesystem content differs');
assert.equal(second.web.contentDigest, first.web.contentDigest, 'Web runtime filesystem content differs');
assert.equal(second.api.configDigest, first.api.configDigest, 'API runtime configuration differs');
assert.equal(second.web.configDigest, first.web.configDigest, 'Web runtime configuration differs');

const firstSbom = readFileSync(path.join(path.dirname(firstPath), 'sbom.cdx.json'), 'utf8');
const secondSbom = readFileSync(path.join(path.dirname(secondPath), 'sbom.cdx.json'), 'utf8');
assert.equal(secondSbom, firstSbom, 'SBOM is not reproducible');

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  buildId: first.manifest.buildId,
  apiContentDigest: first.api.contentDigest,
  webContentDigest: first.web.contentDigest,
  apiConfigDigest: first.api.configDigest,
  webConfigDigest: first.web.configDigest,
  independentImageDigests: true,
  sbomEqual: true,
})}\n`);
