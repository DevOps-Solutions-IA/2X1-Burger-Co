#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [application = 'runtime', revision = 'unknown', runtimeRoot = '/app'] = process.argv.slice(2);
const components = new Map();

add({ type: 'framework', name: 'node', version: process.version.slice(1), purl: `pkg:generic/node@${process.version.slice(1)}` });
readApkDatabase();
walkPackages(runtimeRoot);

const inventory = [...components.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
const identity = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20, 32)}`,
  version: 1,
  metadata: {
    component: { type: 'application', name: `inventory-fastfood-${application}`, version: revision },
    properties: [
      { name: 'inventory:source', value: 'installed-runtime' },
      { name: 'inventory:revision', value: revision },
    ],
  },
  components: inventory,
};
process.stdout.write(`${JSON.stringify(sbom, null, 2)}\n`);

function add(component) {
  const key = component.purl;
  components.set(key, { ...component, 'bom-ref': key });
}

function readApkDatabase() {
  let source;
  try {
    source = readFileSync('/lib/apk/db/installed', 'utf8');
  } catch {
    return;
  }
  for (const block of source.split(/\n\n+/)) {
    const fields = Object.fromEntries(block.split('\n').map((line) => [line.slice(0, 1), line.slice(2)]));
    if (!fields.P || !fields.V) continue;
    add({ type: 'library', name: fields.P, version: fields.V, purl: `pkg:apk/alpine/${encodeURIComponent(fields.P)}@${encodeURIComponent(fields.V)}` });
  }
}

function walkPackages(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkPackages(target);
      continue;
    }
    if (!entry.isFile() || entry.name !== 'package.json') continue;
    try {
      const manifest = JSON.parse(readFileSync(target, 'utf8'));
      if (!manifest.name || !manifest.version) continue;
      const name = String(manifest.name);
      const version = String(manifest.version);
      add({ type: 'library', name, version, purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}` });
    } catch {
      // A malformed package manifest cannot become a valid runtime component.
    }
  }
}
