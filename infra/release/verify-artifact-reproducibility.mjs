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
assert.equal(second.api.digest, first.api.digest, 'API image digest is not reproducible');
assert.equal(second.web.digest, first.web.digest, 'Web image digest is not reproducible');

const firstSbom = readFileSync(path.join(path.dirname(firstPath), 'sbom.cdx.json'), 'utf8');
const secondSbom = readFileSync(path.join(path.dirname(secondPath), 'sbom.cdx.json'), 'utf8');
assert.equal(secondSbom, firstSbom, 'SBOM is not reproducible');

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  buildId: first.manifest.buildId,
  apiDigest: first.api.digest,
  webDigest: first.web.digest,
  sbomEqual: true,
})}\n`);
