import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fieldSource = readFileSync(
  new URL('../../apps/web/src/components/ui/field.tsx', import.meta.url),
  'utf8',
);
const deliverySource = readFileSync(
  new URL('../../apps/web/src/features/delivery-operations/delivery-operations-screen.tsx', import.meta.url),
  'utf8',
);
const routeMatrixSource = readFileSync(
  new URL('../e2e/ephemeral/phase8-route-matrix-accessibility.spec.ts', import.meta.url),
  'utf8',
);

test('required Field controls expose native and ARIA required semantics without dropping existing descriptions', () => {
  assert.match(fieldSource, /mergeDescriptionIds\(/);
  assert.match(fieldSource, /children\.props\['aria-describedby'\]/);
  assert.match(fieldSource, /'aria-required': required \? true : children\.props\['aria-required'\]/);
  assert.match(fieldSource, /required: required \? true : children\.props\.required/);
  assert.match(fieldSource, /'aria-invalid': error \? true : children\.props\['aria-invalid'\]/);
});

test('delivery filter controls keep a minimum 44px touch target', () => {
  assert.match(deliverySource, /compact \? 'min-h-11 px-3 text-xs' : 'min-h-11 px-3\.5 text-sm'/);
  assert.doesNotMatch(deliverySource, /compact \? 'min-h-10/);
});

test('the route accessibility matrix waits for resolved UI and covers desktop', () => {
  assert.match(routeMatrixSource, /name: 'desktop', width: 1440, height: 900/);
  assert.match(routeMatrixSource, /waitForResolvedInterface\(page\)/);
  assert.match(routeMatrixSource, /main \[aria-busy="true"\]:visible/);
  assert.match(routeMatrixSource, /main \[class\*="animate-pulse"\]:visible/);
  assert.match(routeMatrixSource, /document\.fonts\?\.ready/);
});
