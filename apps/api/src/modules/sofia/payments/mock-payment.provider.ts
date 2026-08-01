import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  headerValue,
  ParsedWebhookPayment,
  PaymentProviderAdapter,
  ProviderPaymentStatus,
} from './payment-provider.adapter';

@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly provider = 'MOCK' as const;

  private publicBaseUrl() {
    return (process.env.PUBLIC_PAYMENTS_BASE_URL?.trim() || 'http://localhost:3301').replace(/\/+$/, '');
  }

  private assertMockAllowed() {
    if (process.env.NODE_ENV !== 'test') {
      throw new BadRequestException({ code: 'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN' });
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertMockAllowed();
    const providerPaymentId = `mock_pay_${randomBytes(8).toString('hex')}`;
    const providerReference = `MOCK-${input.orderReference}`;
    return {
      provider: this.provider,
      providerPaymentId,
      providerReference,
      checkoutUrl: `${this.publicBaseUrl()}/pagos/mock/${encodeURIComponent(providerReference)}`,
      status: 'PENDING',
      rawPayload: {
        provider: this.provider,
        providerPaymentId,
        providerReference,
        orderReference: input.orderReference,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }

  async getPaymentStatus(): Promise<ProviderPaymentStatus> {
    this.assertMockAllowed();
    return 'PENDING';
  }

  parseWebhook(rawPayload: unknown): ParsedWebhookPayment {
    this.assertMockAllowed();
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      throw new BadRequestException('Webhook mock inválido.');
    }
    const payload = rawPayload as Record<string, unknown>;
    const providerStatus = String(payload.status ?? 'PENDING').toUpperCase();
    const status: ProviderPaymentStatus =
      providerStatus === 'PAID' || providerStatus === 'APPROVED'
        ? 'APPROVED'
        : providerStatus === 'FAILED'
          ? 'FAILED'
          : providerStatus === 'REVIEW'
            ? 'REVIEW'
            : 'PENDING';

    return {
      eventId: typeof payload.eventId === 'string' ? payload.eventId : null,
      eventType: typeof payload.eventType === 'string' ? payload.eventType : `mock.payment.${status.toLowerCase()}`,
      providerPaymentId: typeof payload.providerPaymentId === 'string' ? payload.providerPaymentId : null,
      providerReference: typeof payload.providerReference === 'string' ? payload.providerReference : null,
      orderReference: typeof payload.orderReference === 'string' ? payload.orderReference : null,
      status,
      amount: payload.amount == null ? null : Number(payload.amount),
      currency: typeof payload.currency === 'string' ? payload.currency : null,
      rawPayload: payload,
    };
  }

  verifyWebhookSignature(_rawPayload: unknown, headers: Record<string, string | string[] | undefined>): boolean {
    this.assertMockAllowed();
    return headerValue(headers, 'x-mock-payment-signature') === 'mock-dev-signature';
  }

}
