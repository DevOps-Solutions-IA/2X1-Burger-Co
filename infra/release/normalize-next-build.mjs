import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'apps/web/.next');
const releaseSecret = process.env.RELEASE_REPRODUCIBILITY_SECRET;
if (!releaseSecret || !/^[a-f0-9]{64}$/.test(releaseSecret)) {
  throw new Error('A 256-bit hexadecimal release reproducibility secret is required.');
}

for (const relative of [
  'app-build-manifest.json',
  'app-path-routes-manifest.json',
  'server/app-paths-manifest.json',
]) {
  const file = path.join(root, relative);
  writeFileSync(file, JSON.stringify(stable(parse(file), false)));
}

const prerenderPath = path.join(root, 'prerender-manifest.json');
const fontJsonPath = path.join(root, 'server/next-font-manifest.json');
const fontJsPath = path.join(root, 'server/next-font-manifest.js');
const referencesPath = path.join(root, 'server/server-reference-manifest.json');

const prerender = parse(prerenderPath);
prerender.preview = {
  previewModeId: deterministicHex('preview-id', 16),
  previewModeSigningKey: deterministicHex('preview-signing', 32),
  previewModeEncryptionKey: deterministicHex('preview-encryption', 32),
};
writeFileSync(prerenderPath, JSON.stringify(stable(prerender, false)));

const fontManifest = stable(parse(fontJsonPath), true);
const fontJson = JSON.stringify(fontManifest);
writeFileSync(fontJsonPath, fontJson);
writeFileSync(fontJsPath, `self.__NEXT_FONT_MANIFEST='${fontJson}';`);

const references = parse(referencesPath);
if (Object.keys(references.node ?? {}).length || Object.keys(references.edge ?? {}).length) {
  throw new Error('Deterministic public build key is forbidden when Server Actions exist.');
}
writeFileSync(referencesPath, JSON.stringify(stable(references, false)));

for (const file of walk(path.join(root, 'server/app'))) {
  if (!file.endsWith('_client-reference-manifest.js')) continue;
  const source = readFileSync(file, 'utf8');
  const marker = ';globalThis.__RSC_MANIFEST[';
  const assignment = source.indexOf(marker);
  const separator = source.indexOf('=', assignment + marker.length);
  if (assignment < 0 || separator < 0) throw new Error(`Unsupported client reference manifest format: ${file}`);
  const value = JSON.parse(source.slice(separator + 1));
  writeFileSync(file, `${source.slice(0, separator + 1)}${JSON.stringify(stable(value, false))}`);
}

function parse(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stable(value, sortStringArrays) {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => stable(entry, sortStringArrays));
    return sortStringArrays && normalized.every((entry) => typeof entry === 'string')
      ? normalized.sort()
      : normalized;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key], sortStringArrays)]));
}

function deterministicHex(purpose, bytes) {
  return createHmac('sha256', releaseSecret).update(`2x1-next-${purpose}`).digest('hex').slice(0, bytes * 2);
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}
