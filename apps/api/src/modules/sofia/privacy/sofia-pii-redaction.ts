export function redactPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return `***${digits}`;
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

export function hashPreview(value: string | null | undefined) {
  if (!value) return null;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
}

export function redactSensitiveText(value: string | null | undefined) {
  if (!value) return value ?? null;
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[correo-redactado]')
    .replace(/(?<!\d)(?:\+?57[\s.-]*)?3(?:[\s.-]*\d){9}(?!\d)/g, '[telefono-redactado]')
    .replace(/\b(?:sk-|AIza|eyJ|or-)[A-Za-z0-9._-]{8,}\b/g, '[secreto-redactado]')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[private-key-redactada]')
    .replace(/\b\d{12,}\b/g, '[numero-largo-redactado]')
    .replace(/(?:calle|carrera|cra\.?|cl\.?|av\.?|avenida|transversal|diagonal)\s+[^,.;\n]{3,80}/gi, '[direccion-redactada]');
}

export function sanitizeJson<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === 'string') return redactSensitiveText(value) as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('no') && typeof raw === 'boolean') {
      output[key] = raw;
      continue;
    }
    if (lower.includes('token') || lower.includes('secret') || lower.includes('apikey') || lower.includes('api_key')) {
      output[key] = '[secreto-redactado]';
      continue;
    }
    if (lower.includes('phone')) {
      output[key] = typeof raw === 'string' ? redactPhone(raw) : sanitizeJson(raw);
      continue;
    }
    if (lower.includes('address')) {
      output[key] = typeof raw === 'string' ? '[direccion-redactada]' : sanitizeJson(raw);
      continue;
    }
    if (lower === 'rawpayload' || lower === 'qrstring' || lower === 'sessionpath') {
      output[key] = '[raw-redactado]';
      continue;
    }
    output[key] = sanitizeJson(raw);
  }
  return output as T;
}
