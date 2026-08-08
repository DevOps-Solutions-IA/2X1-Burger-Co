import { createHash } from 'node:crypto';

const excluded = new Set(['aiSummary', 'llmProse', 'rawMessage', 'hiddenReasoning', 'createdAt', 'updatedAt']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, entry]) => entry !== undefined && !excluded.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

export function commercialDraftHash(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
