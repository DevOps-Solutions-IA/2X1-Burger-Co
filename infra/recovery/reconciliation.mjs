import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function compareReconciliation(source, restored) {
  const equal = isDeepStrictEqual(source, restored);
  return { status: equal ? 'PASS' : 'FAIL', equal, source, restored };
}

function run() {
  const [sourcePath, restorePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !restorePath || !outputPath) {
    throw new Error('usage: reconciliation.mjs <source.json> <restored.json> <result.json>');
  }
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const restored = JSON.parse(readFileSync(restorePath, 'utf8'));
  const result = compareReconciliation(source, restored);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  if (!result.equal) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
