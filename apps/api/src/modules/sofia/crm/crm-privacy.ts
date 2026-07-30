const SENSITIVE_KEY = /(address|authorization|body|credential|email|message|payload|phone|raw|secret|token|whatsapp)/i;
const PHONE_PATTERN = /(?:\+?57[\s-]?)?3(?:[\s-]?\d){9}/g;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length >= 4 ? `*** *** ${local.slice(-4)}` : '***';
}

export function sanitizeTimelineText(value: string): string {
  return value
    .replace(PHONE_PATTERN, (phone) => maskPhone(phone))
    .replace(EMAIL_PATTERN, (email) => {
      const domain = email.split('@')[1] ?? 'redacted';
      return `***@${domain}`;
    })
    .slice(0, 1_000);
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
