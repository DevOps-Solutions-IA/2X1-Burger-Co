import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SecureCommandError } from './secure-command.errors';

const SECRET_KEY = /(password|secret|token|authorization|cookie|credential|apikey|api_key|cvv|card|sessionauth)/i;
const PII_KEY = /(phone|telefono|mobile|whatsapp|email|address|direccion|location)/i;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;
const MAX_STRING = 512;
const MAX_BYTES = 16_384;

@Injectable()
export class CommandRedactionService {
  payloadHash(value: unknown) {
    return this.hash(this.canonical(this.forHash(value, 0, null)));
  }

  sanitizeResult(value: unknown) {
    const sanitized = this.forResult(value, 0, null);
    const serialized = JSON.stringify(sanitized);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    return JSON.parse(serialized) as unknown;
  }

  resultHash(value: unknown) {
    return this.hash(this.canonical(value));
  }

  hashIdentifier(value: string) {
    return this.hash(value.trim());
  }

  private forHash(value: unknown, depth: number, key: string | null): unknown {
    if (depth > MAX_DEPTH) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    if (key && SECRET_KEY.test(key)) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().slice(0, MAX_STRING);
      return key && PII_KEY.test(key) ? `[HASH:${this.hash(normalized)}]` : normalized;
    }
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => this.forHash(item, depth + 1, key));
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, MAX_ITEMS)
          .map(([entryKey, entryValue]) => [entryKey, this.forHash(entryValue, depth + 1, entryKey)]),
      );
    }
    throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
  }

  private forResult(value: unknown, depth: number, key: string | null): unknown {
    if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
    if (key && (SECRET_KEY.test(key) || PII_KEY.test(key))) return '[REDACTED]';
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.slice(0, MAX_STRING);
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => this.forResult(item, depth + 1, key));
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, MAX_ITEMS)
          .map(([entryKey, entryValue]) => [entryKey, this.forResult(entryValue, depth + 1, entryKey)]),
      );
    }
    return String(value).slice(0, MAX_STRING);
  }

  private canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${this.canonical(entry)}`)
      .join(',')}}`;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
