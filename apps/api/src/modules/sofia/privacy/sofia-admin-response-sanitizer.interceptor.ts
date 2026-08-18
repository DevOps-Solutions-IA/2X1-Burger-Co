import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { redactSensitiveText } from './sofia-pii-redaction';

const OMITTED_KEYS = new Set([
  'rawPayload',
  'publicPaymentToken',
  'providerCheckoutUrl',
]);

@Injectable()
export class SofiaAdminResponseSanitizerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => this.sanitize(value)));
  }

  private sanitize(value: unknown): unknown {
    if (value == null) return value;
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return redactSensitiveText(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') return this.sanitize(toJSON.call(value));

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (OMITTED_KEYS.has(key)) continue;
      if (this.isPhoneKey(key) && typeof nested === 'string') {
        result[key] = this.maskPhone(nested);
        continue;
      }
      result[key] = this.sanitize(nested);
    }
    return result;
  }

  private isPhoneKey(key: string) {
    return key.toLowerCase().includes('phone') && key !== 'phoneMasked';
  }

  private maskPhone(value: string) {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '[REDACTED]';
    return `${'*'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
  }
}
