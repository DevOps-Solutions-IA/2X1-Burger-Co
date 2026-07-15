#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveMigrationExpectation } from '../schema/migration-expectation.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function git(command) {
  return execFileSync('git', command, { encoding: 'utf8' }).trim();
}

function parseBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

const root = process.cwd();
const output = path.resolve(root, argument('--output', '.release/release-manifest.json'));
const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const apiPackage = JSON.parse(readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));
const commit = process.env.RELEASE_GIT_COMMIT ?? git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('RELEASE_GIT_COMMIT must be a full SHA-1 commit');

const dirtyBuild = process.env.RELEASE_DIRTY_BUILD === undefined
  ? git(['status', '--porcelain']).length > 0
  : parseBoolean(process.env.RELEASE_DIRTY_BUILD, 'RELEASE_DIRTY_BUILD');
const environment = process.env.RELEASE_ENVIRONMENT ?? 'staging';
if (!['development', 'test', 'staging', 'production'].includes(environment)) {
  throw new Error('RELEASE_ENVIRONMENT is invalid');
}
if (dirtyBuild && ['staging', 'production'].includes(environment) && process.env.ALLOW_DIRTY_RELEASE !== 'true') {
  throw new Error('Dirty source cannot produce a staging or production release');
}

const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? git(['show', '-s', '--format=%ct', commit]));
if (!Number.isInteger(epoch) || epoch <= 0) throw new Error('SOURCE_DATE_EPOCH must be a positive integer');
const short = commit.slice(0, 12);
const releaseVersion = `${rootPackage.version}-${short}`;
const buildId = `${releaseVersion}-${epoch}`;
const schemaExpectation = resolveMigrationExpectation(path.join(root, 'prisma/migrations'));

const manifest = {
  application: 'inventory-fastfood-system',
  releaseVersion,
  gitCommit: commit,
  gitCommitShort: short,
  buildTimestamp: new Date(epoch * 1000).toISOString(),
  buildId,
  environment,
  artifactDigest: null,
  apiVersion: apiPackage.version,
  schemaCompatibilityVersion: `prisma-${schemaExpectation.latest}`,
  dirtyBuild,
  sourceRepository: 'inventory-fastfood-system',
};

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${JSON.stringify({ output, buildId, gitCommit: commit, dirtyBuild })}\n`);
