import { sanitizeJson } from '../privacy/sofia-pii-redaction';

export function sofiaSafeLogPayload(payload: Record<string, unknown>) {
  return sanitizeJson({
    ...payload,
    rawPayload: payload.rawPayload ? '[raw-redactado]' : undefined,
    qrString: payload.qrString ? '[qr-redactado]' : undefined,
    sessionPath: payload.sessionPath ? '[session-path-redactado]' : undefined,
  });
}
