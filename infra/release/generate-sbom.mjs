#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const lockPath = path.resolve(argument('--lockfile', 'pnpm-lock.yaml'));
const output = path.resolve(argument('--output', '.release/sbom.cdx.json'));
const lock = readFileSync(lockPath, 'utf8');
const lockHash = createHash('sha256').update(lock).digest('hex');
const packageBlock = lock.match(/^packages:\n([\s\S]*?)^snapshots:/m)?.[1] ?? '';
const components = new Map();

for (const line of packageBlock.split('\n')) {
  const match = line.match(/^  ['"]?(.+?)['"]?:\s*$/);
  if (!match) continue;
  const locator = match[1].replace(/\(.+\)$/, '');
  const separator = locator.lastIndexOf('@');
  if (separator <= 0) continue;
  const name = locator.slice(0, separator);
  const version = locator.slice(separator + 1);
  if (!name || !version || name.startsWith('link:') || name.startsWith('file:')) continue;
  const key = `${name}@${version}`;
  components.set(key, {
    type: 'library',
    'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
    name,
    version,
    purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
  });
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${lockHash.slice(0, 8)}-${lockHash.slice(8, 12)}-${lockHash.slice(12, 16)}-${lockHash.slice(16, 20)}-${lockHash.slice(20, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString(),
    component: { type: 'application', name: 'inventory-fastfood-system' },
    properties: [{ name: 'inventory:pnpm-lock-sha256', value: lockHash }],
  },
  components: [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
};

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, components: components.size, lockHash })}\n`);
