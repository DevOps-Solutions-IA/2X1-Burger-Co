import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'apps/web/.next');
const prerenderPath = path.join(root, 'prerender-manifest.json');
const fontJsonPath = path.join(root, 'server/next-font-manifest.json');
const fontJsPath = path.join(root, 'server/next-font-manifest.js');
const referencesPath = path.join(root, 'server/server-reference-manifest.json');

const prerender = stable(parse(prerenderPath), false);
writeFileSync(prerenderPath, JSON.stringify(prerender));

const fontManifest = stable(parse(fontJsonPath), true);
const fontJson = JSON.stringify(fontManifest);
writeFileSync(fontJsonPath, fontJson);
writeFileSync(fontJsPath, `self.__NEXT_FONT_MANIFEST='${fontJson}';`);

const references = parse(referencesPath);
if (Object.keys(references.node ?? {}).length || Object.keys(references.edge ?? {}).length) {
  throw new Error('Deterministic public build key is forbidden when Server Actions exist.');
}
writeFileSync(referencesPath, JSON.stringify(stable(references, false)));

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
