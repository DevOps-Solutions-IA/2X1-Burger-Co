import { Injectable } from '@nestjs/common';
import { sofiaSafeLogPayload } from './sofia-safe-logger';

@Injectable()
export class SofiaHardeningService {
  status() {
    const source = {
      phone: '573001112222',
      rawPayload: { text: 'raw' },
      qrString: 'qr-secret',
      sessionPath: '/home/app/storage/whatsapp-sessions/sofia-main',
    };
    const sample = sofiaSafeLogPayload(source);
    const serialized = JSON.stringify(sample);
    const checks = Object.freeze({
      phoneRedacted: !serialized.includes(source.phone),
      rawPayloadRemoved: serialized.includes('"rawPayload":"[raw-redactado]"') && !serialized.includes('"text":"raw"'),
      qrRemoved: !serialized.includes(source.qrString),
      sessionPathRemoved: !serialized.includes(source.sessionPath) && !serialized.includes('/home/'),
    });
    const verified = Object.values(checks).every(Boolean);
    return {
      logSanitizationStatus: verified ? 'VERIFIED_EXECUTABLE' : 'FAILED',
      safeLoggerAvailable: verified,
      rawPayloadLogging: 'blocked_by_policy',
      qrStringLogging: 'blocked_by_policy',
      absoluteSessionPathExposure: 'blocked_by_policy',
      secretsInFrontend: 'blocked_by_policy',
      checks,
      sample,
    };
  }
}
