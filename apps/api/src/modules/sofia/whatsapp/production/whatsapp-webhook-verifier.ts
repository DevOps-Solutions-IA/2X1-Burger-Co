import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WhatsappWebhookVerifier {
  constructor(private readonly config: ConfigService) {}

  verifyHermes(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    const secret = this.config.get<string>('HERMES_WEBHOOK_SECRET');
    if (!secret || !rawBody?.length) return { valid: false, reasonCode: 'WHATSAPP_SIGNATURE_MISSING_INPUT' };
    const rawHeader = headers['x-hermes-signature'] ?? headers['X-Hermes-Signature'];
    const signature = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
      return { valid: false, reasonCode: 'WHATSAPP_SIGNATURE_MISSING' };
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature.slice(7), 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
      ? { valid: true, reasonCode: 'WHATSAPP_SIGNATURE_VALID' }
      : { valid: false, reasonCode: 'WHATSAPP_SIGNATURE_INVALID' };
  }
}
