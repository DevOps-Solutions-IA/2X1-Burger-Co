import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /(address|authorization|body|credential|email|message|payload|phone|raw|secret|token|whatsapp)/i;
const PHONE_PATTERN = /(?:\+?57[\s-]?)?3(?:[\s-]?\d){9}/g;
const INTERNATIONAL_PHONE_PATTERN = /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,15}/g;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;
const AUTHORIZATION_HEADER_PATTERN = /\bauthorization\s*:\s*(?:basic|bearer)\s+[^\s,;]+/gi;
const AUTH_SCHEME_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/-]+=*/gi;
const COOKIE_HEADER_PATTERN = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?(?:key(?:[_-]?id)?|token)|authorization|auth[_-]?token|client[_-]?secret|credential|cookie|password|passwd|private[_-]?key|secret|session(?:[_-]?(?:id|key|token))?|token)\s*(?::|=>|=)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const KNOWN_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,255}\b|\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length >= 4 ? `*** *** ${local.slice(-4)}` : '***';
}

export function sanitizeTimelineText(value: string): string {
  return Array.from(value.normalize('NFKC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '\n' || character === '\r') return character;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }).join('')
    .replace(PRIVATE_KEY_PATTERN, '[PRIVATE_KEY_REDACTED]')
    .replace(AUTHORIZATION_HEADER_PATTERN, '[AUTHORIZATION_REDACTED]')
    .replace(COOKIE_HEADER_PATTERN, '[COOKIE_HEADER_REDACTED]')
    .replace(AUTH_SCHEME_PATTERN, '[TOKEN_REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '[SECRET_REDACTED]')
    .replace(KNOWN_ACCESS_KEY_PATTERN, '[ACCESS_KEY_REDACTED]')
    .replace(PAYMENT_CARD_PATTERN, '[PAYMENT_DATA_REDACTED]')
    .replace(PHONE_PATTERN, (phone) => maskPhone(phone))
    .replace(INTERNATIONAL_PHONE_PATTERN, (phone) => maskPhone(phone))
    .replace(EMAIL_PATTERN, (email) => {
      const domain = email.split('@')[1] ?? 'redacted';
      return `***@${domain}`;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000);
}

export function opaqueCrmReference(namespace: string, value: string): string {
  return createHash('sha256')
    .update(namespace.normalize('NFKC').trim(), 'utf8')
    .update('\0', 'utf8')
    .update(value.normalize('NFKC').trim(), 'utf8')
    .digest('hex');
}

export function sanitizeTimelineMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeTimelineText(value).slice(0, 256);
  if (typeof value === 'number') {
    const digits = String(value);
    return /^3\d{9}$|^573\d{9}$/.test(digits) ? maskPhone(digits) : value;
  }
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeTimelineMetadata(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeTimelineMetadata(entry, depth + 1),
      ]),
  );
}
