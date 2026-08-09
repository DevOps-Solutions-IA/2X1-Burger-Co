import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../../config/env';

type PublicPaymentReference = {
  linkId: string;
  expiresAt: Date;
};

type SignedPayload = {
  v: 1;
  l: string;
  e: number;
};

@Injectable()
export class PaymentPublicReferenceService {
  private readonly context = '2x1-payment-link:v1';

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  issue(input: PublicPaymentReference): string {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, l: input.linkId, e: input.expiresAt.getTime() } satisfies SignedPayload),
      'utf8',
    ).toString('base64url');
    return `${payload}.${this.signature(payload).toString('base64url')}`;
  }

  verify(reference: string): PublicPaymentReference | null {
    const [payload, suppliedSignature, extra] = reference.split('.');
    if (!payload || !suppliedSignature || extra) return null;

    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedSignature, 'base64url');
    } catch {
      return null;
    }
    const expected = this.signature(payload);
    if (
      supplied.length !== expected.length ||
      supplied.toString('base64url') !== suppliedSignature ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    try {
      const decoded = Buffer.from(payload, 'base64url');
      if (decoded.toString('base64url') !== payload) return null;
      const parsed = JSON.parse(decoded.toString('utf8')) as Partial<SignedPayload>;
      if (
        parsed.v !== 1 ||
        typeof parsed.l !== 'string' ||
        !/^[A-Za-z0-9_-]{20,64}$/.test(parsed.l) ||
        typeof parsed.e !== 'number' ||
        !Number.isSafeInteger(parsed.e) ||
        parsed.e <= 0
      ) {
        return null;
      }
      return { linkId: parsed.l, expiresAt: new Date(parsed.e) };
    } catch {
      return null;
    }
  }

  private signature(payload: string): Buffer {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(`${this.context}.${payload}`, 'utf8')
      .digest();
  }
}
