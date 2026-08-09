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
    const previewInput = 'privacy-control-probe';
    const preview = this.hashPreview(previewInput);
    const sanitized = this.sanitizeJson<Record<string, unknown>>({
      phone: '+57 300 123 4567',
      address: 'Carrera 1 # 2-3',
      accessToken: 'privacy-control-probe',
      rawPayload: { private: true },
    });
    const controls = {
      phoneRedaction: this.redactPhone('+57 300 123 4567') === '57***4567',
      textRedaction:
        this.redactText('Contacto 3001234567 en Carrera 1 # 2-3') ===
        'Contacto [telefono-redactado] en [direccion-redactada]',
      structuredRedaction:
        sanitized.phone === '57***4567' &&
        sanitized.address === '[direccion-redactada]' &&
        sanitized.accessToken === '[secreto-redactado]' &&
        sanitized.rawPayload === '[raw-redactado]',
      stablePseudonymousPreview:
        preview === this.hashPreview(previewInput) && preview !== previewInput && /^[a-f0-9]{8}$/.test(preview ?? ''),
    };
    const verified = Object.values(controls).every(Boolean);

    return {
      status: verified ? 'CONTROLS_VERIFIED' : 'CONTROL_FAILURE',
      evidenceSource: 'EXECUTABLE_RUNTIME_PROBE',
      controls,
      piiRedactionEnabled: verified,
      phonePolicy: 'hash_or_last4_only',
      messagePolicy: 'previews_sanitized_by_default',
      qrSessionPolicy: 'no_absolute_session_path',
      secretsPolicy: 'redacted',
    };
  }
}
