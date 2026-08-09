import { createHash } from 'node:crypto';
import {
  COMPLAINT_FACT_KINDS,
  COMPLAINT_FACT_SOURCES,
  type ComplaintFact,
  type ComplaintFactKind,
  type NewComplaintFact,
} from './complaint-recovery.types';

const FACT_NAMESPACE = 'customer-service:complaint-fact:v1';
const REFERENCE_NAMESPACE = 'customer-service:complaint-reference:v1';
const MAX_FACT_LENGTH = 1_000;
const HASH = /^[a-f0-9]{64}$/;
const REFERENCE_FACTS: ReadonlySet<ComplaintFactKind> = new Set(['ORDER_REFERENCE_HASH', 'EVIDENCE_REFERENCE_HASH']);

export class ComplaintFactError extends Error {
  constructor(readonly code: 'COMPLAINT_FACT_INVALID' | 'COMPLAINT_FACT_EMPTY' | 'COMPLAINT_FACT_TIMESTAMP_INVALID') {
    super(code);
    this.name = 'ComplaintFactError';
  }
}

function digest(namespace: string, value: string): string {
  return createHash('sha256').update(`${namespace}\0${value}`, 'utf8').digest('hex');
}

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }).join('');
}

function redact(value: string): string {
  return stripControlCharacters(value.slice(0, MAX_FACT_LENGTH * 4).normalize('NFKC'))
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[TOKEN_REDACTED]')
    .replace(/\b(?:password|passwd|secret|token)\s*[:=]\s*\S+/gi, '[SECRET_REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[PAYMENT_DATA_REDACTED]')
    .replace(/(?:\+?\d[\s().-]*){8,15}/g, '[PHONE_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FACT_LENGTH);
}

function normalizeTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ComplaintFactError('COMPLAINT_FACT_TIMESTAMP_INVALID');
  return date.toISOString();
}

function factValue(kind: ComplaintFactKind, rawValue: string): string {
  const normalized = redact(rawValue);
  if (!normalized) throw new ComplaintFactError('COMPLAINT_FACT_EMPTY');
  if (!REFERENCE_FACTS.has(kind)) return normalized;
  return HASH.test(normalized) ? normalized : digest(REFERENCE_NAMESPACE, normalized);
}

export function createImmutableComplaintFact(input: NewComplaintFact): ComplaintFact {
  if (
    !COMPLAINT_FACT_KINDS.includes(input.kind)
    || !COMPLAINT_FACT_SOURCES.includes(input.source)
    || typeof input.value !== 'string'
  ) {
    throw new ComplaintFactError('COMPLAINT_FACT_INVALID');
  }
  const value = factValue(input.kind, input.value);
  const recordedAt = normalizeTimestamp(input.recordedAt);
  const supersedesFactId = input.supersedesFactId ?? null;
  if (supersedesFactId !== null && !HASH.test(supersedesFactId)) throw new ComplaintFactError('COMPLAINT_FACT_INVALID');
  const binding = JSON.stringify([input.kind, value, input.source, recordedAt, supersedesFactId]);
  return Object.freeze({
    id: digest(FACT_NAMESPACE, binding),
    kind: input.kind,
    value,
    source: input.source,
    recordedAt,
    supersedesFactId,
    sanitizationVersion: 1,
  });
}

export function immutableComplaintFacts(facts: readonly ComplaintFact[]): readonly ComplaintFact[] {
  return Object.freeze(facts.map((fact) => Object.freeze({ ...fact })));
}
