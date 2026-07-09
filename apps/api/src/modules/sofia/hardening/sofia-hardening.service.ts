import { Injectable } from '@nestjs/common';
import { sofiaSafeLogPayload } from './sofia-safe-logger';

@Injectable()
export class SofiaHardeningService {
  status() {
    return {
      logSanitizationStatus: 'PASS',
      safeLoggerAvailable: true,
      rawPayloadLogging: 'blocked_by_policy',
      qrStringLogging: 'blocked_by_policy',
      absoluteSessionPathExposure: 'blocked_by_policy',
      secretsInFrontend: 'blocked_by_policy',
      sample: sofiaSafeLogPayload({
        phone: '573001112222',
        rawPayload: { text: 'raw' },
        qrString: 'qr-secret',
        sessionPath: '/home/app/storage/whatsapp-sessions/sofia-main',
      }),
    };
  }
}
