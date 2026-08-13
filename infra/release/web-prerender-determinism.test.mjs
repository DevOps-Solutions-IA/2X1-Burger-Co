import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('authenticated shell defers the local calendar to hydration', () => {
  const source = readFileSync('apps/web/src/components/app-shell.tsx', 'utf8');

  assert.match(source, /useState\('Fecha local'\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?setToday\(new Date\(\)/);
  assert.doesNotMatch(source, /const today = new Date\(\)/);
});

test('dashboard clock is deterministic during static prerender', () => {
  const source = readFileSync('apps/web/src/app/(app)/dashboard/page.tsx', 'utf8');

  assert.match(source, /useState<\{ greeting: string; today: string; now: string \} \| null>\(null\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?updateClock\(\)/);
  assert.match(source, /clock\?\.now \?\? '--:--'/);
  assert.doesNotMatch(source, /const (?:greeting|today|now) = get(?:Greeting|TodayLabel|TimeLabel)\(\)/);
});
