import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSurfaces = [
  'PosCartPanel.tsx',
  'PosOrderMetadataPanel.tsx',
  'PosDeliveryPanel.tsx',
  'PosProductBrowser.tsx',
] as const;

function source(fileName: string) {
  // The test only passes names from the closed posSurfaces tuple above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL(fileName, import.meta.url), 'utf8');
}

test('keeps POS operational text at a minimum 12px size', () => {
  for (const fileName of posSurfaces) {
    assert.doesNotMatch(
      source(fileName),
      /text-\[(?:9|10|11)px\]/,
      `${fileName} contains operational text below 12px`,
    );
  }
});

test('keeps low-contrast tokens off light POS operational surfaces', () => {
  for (const fileName of posSurfaces) {
    const fileSource = source(fileName);

    assert.doesNotMatch(fileSource, /text-stone-400/, `${fileName} uses stone-400`);
    assert.doesNotMatch(fileSource, /text-brand-700/, `${fileName} uses brand-700`);
  }

  assert.doesNotMatch(
    source('PosCartPanel.tsx'),
    /difference > 0 \? 'text-brand-600'/,
    'PosCartPanel uses low-contrast brand-600 for a financial amount',
  );
});
