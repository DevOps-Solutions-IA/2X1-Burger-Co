import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [firstPath, secondPath] = process.argv.slice(2);
if (!firstPath || !secondPath) {
  throw new Error('Usage: verify-artifact-reproducibility.mjs <first-record> <second-record>');
}

const first = JSON.parse(readFileSync(firstPath, 'utf8'));
const second = JSON.parse(readFileSync(secondPath, 'utf8'));
assert.deepEqual(second.manifest, first.manifest, 'release manifests differ across clean builds');
assert.deepEqual(first.provenance, { type: 'retained-local-image-runtime-equivalence', registryManifestDigest: null, registryPushAuthorized: false });
assert.deepEqual(second.provenance, first.provenance);
for (const record of [first, second]) {
  for (const target of [record.api, record.web]) {
    for (const field of ['digest', 'localImageConfigDigest', 'contentDigest', 'configDigest', 'layerSetDigest', 'runtimeRootfsDigest', 'sbomDigest', 'archiveDigest']) {
      assert.match(target[field], /^sha256:[a-f0-9]{64}$/, `${field} is missing or malformed`);
    }
    assert.equal(target.localImageConfigDigest, target.digest, 'local image identity is inconsistent');
  }
}
assert.notEqual(second.api.tag, first.api.tag, 'API reproduction reused the original tag');
assert.notEqual(second.web.tag, first.web.tag, 'Web reproduction reused the original tag');
assert.equal(second.api.contentDigest, first.api.contentDigest, 'API runtime filesystem content differs');
assert.equal(second.web.contentDigest, first.web.contentDigest, 'Web runtime filesystem content differs');
assert.equal(second.api.configDigest, first.api.configDigest, 'API runtime configuration differs');
assert.equal(second.web.configDigest, first.web.configDigest, 'Web runtime configuration differs');
assert.equal(second.api.runtimeRootfsDigest, first.api.runtimeRootfsDigest, 'API complete runtime RootFS differs');
assert.equal(second.web.runtimeRootfsDigest, first.web.runtimeRootfsDigest, 'Web complete runtime RootFS differs');
assert.equal(second.api.sbomDigest, first.api.sbomDigest, 'API installed-runtime SBOM differs');
assert.equal(second.web.sbomDigest, first.web.sbomDigest, 'Web installed-runtime SBOM differs');

for (const name of ['sbom.cdx.json', 'api-sbom.cdx.json', 'web-sbom.cdx.json']) {
  const firstSbom = readFileSync(path.join(path.dirname(firstPath), name), 'utf8');
  const secondSbom = readFileSync(path.join(path.dirname(secondPath), name), 'utf8');
  assert.equal(secondSbom, firstSbom, `${name} is not reproducible`);
}
for (const target of ['api', 'web']) {
  const name = `${target}-sbom.cdx.json`;
  for (const [record, recordPath] of [[first, firstPath], [second, secondPath]]) {
    const bytes = readFileSync(path.join(path.dirname(recordPath), name));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(record[target].sbomDigest, digest, `${target} SBOM digest is not bound to its file`);
  }
  for (const [record, recordPath] of [[first, firstPath], [second, secondPath]]) {
    assert.equal(record[target].archive, `${target}-image.tar.gz`);
    const bytes = readFileSync(path.join(path.dirname(recordPath), record[target].archive));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(record[target].archiveDigest, digest, `${target} archive digest is not bound to its file`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  buildId: first.manifest.buildId,
  apiContentDigest: first.api.contentDigest,
  webContentDigest: first.web.contentDigest,
  apiConfigDigest: first.api.configDigest,
  webConfigDigest: first.web.configDigest,
  exactFirstBuildArchivesRetained: true,
  completeRuntimeRootfsEqual: true,
  layerSerializationMayDiffer: true,
  installedRuntimeSbomsEqual: true,
  registryManifestDigestPendingAuthorizedPush: true,
})}\n`);
