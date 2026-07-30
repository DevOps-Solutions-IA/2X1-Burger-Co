#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [apiPath, webPath, expectedCommit, expectedApiDigest, expectedWebDigest] = process.argv.slice(2);
if (!apiPath || !webPath) throw new Error('API and web version files are required.');
if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw new Error('Expected commit is invalid.');
for (const digest of [expectedApiDigest, expectedWebDigest]) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Expected artifact digest is invalid.');
}

const api = JSON.parse(readFileSync(apiPath, 'utf8'));
const web = JSON.parse(readFileSync(webPath, 'utf8'));
for (const [name, value] of [['api', api], ['web', web]]) {
  if (value.commitSha !== expectedCommit) throw new Error(`${name} runtime commit does not match the release candidate.`);
}
if (api.artifactDigest !== expectedApiDigest || web.artifactDigest !== expectedWebDigest) {
  throw new Error('Runtime artifact digests do not match the deployed images.');
}
if (!api.buildId || api.buildId !== web.buildId) throw new Error('API and web build identities do not match.');
if (!Number.isInteger(api.migrationCount) || api.migrationCount <= 0 || api.migrationCount !== web.migrationCount) {
  throw new Error('API and web migration identities do not match.');
}
if (api.releaseManifestVersion !== 1 || web.releaseManifestVersion !== 1) {
  throw new Error('Runtime release manifest contract is unsupported.');
}

process.stdout.write(`${JSON.stringify({
  commit: expectedCommit,
  buildId: api.buildId,
  migrationCount: api.migrationCount,
  releaseManifestVersion: api.releaseManifestVersion,
  digestsVerified: true,
})}\n`);
