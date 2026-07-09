import { Injectable } from '@nestjs/common';
import { hashPreview, redactPhone, redactSensitiveText, sanitizeJson } from './sofia-pii-redaction';

@Injectable()
export class SofiaPrivacyService {
  redactPhone(phone: string | null | undefined) {
    return redactPhone(phone);
  }

  hashPreview(value: string | null | undefined) {
    return hashPreview(value);
  }

  redactText(value: string | null | undefined) {
    return redactSensitiveText(value);
  }

  sanitizeJson<T>(value: T): T {
    return sanitizeJson(value);
  }

  status() {
    return {
      status: 'PASS',
      piiRedactionEnabled: true,
      phonePolicy: 'hash_or_last4_only',
      messagePolicy: 'previews_sanitized_by_default',
      qrSessionPolicy: 'no_absolute_session_path',
      secretsPolicy: 'redacted',
    };
  }
}
