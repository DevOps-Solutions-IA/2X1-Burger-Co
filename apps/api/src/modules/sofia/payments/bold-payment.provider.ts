import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WhatsappPaymentStatus } from '@prisma/client';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  headerValue,
  ParsedWebhookPayment,
  PaymentProviderAdapter,
  ProviderPaymentStatus,
} from './payment-provider.adapter';

@Injectable()
export class BoldPaymentProvider implements PaymentProviderAdapter {
  readonly provider = 'BOLD' as const;

  private isConfigured() {
    return Boolean(process.env.BOLD_API_KEY && process.env.BOLD_SECRET_KEY && process.env.BOLD_WEBHOOK_SECRET);
  }

  async createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Bold no está configurado. No se inició pago real.');
    }
    throw new BadRequestException('BoldPaymentProvider está preparado, pero la integración real permanece desactivada en esta fase.');
  }

  async getPaymentStatus(_reference: string): Promise<ProviderPaymentStatus> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Bold no está configurado.');
    }
    return 'PENDING';
  }

  parseWebhook(rawPayload: unknown): ParsedWebhookPayment {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      throw new BadRequestException('Webhook Bold inválido.');
    }
    const payload = rawPayload as Record<string, unknown>;
    const rawStatus = String(payload.status ?? payload.paymentStatus ?? 'PENDING').toUpperCase();
    const status: ProviderPaymentStatus =
      ['APPROVED', 'PAID', 'SUCCESSFUL'].includes(rawStatus)
        ? 'APPROVED'
        : ['FAILED', 'REJECTED', 'DECLINED'].includes(rawStatus)
          ? 'FAILED'
          : rawStatus === 'REVIEW'
            ? 'REVIEW'
            : 'PENDING';

    return {
      eventId: typeof payload.eventId === 'string' ? payload.eventId : typeof payload.id === 'string' ? payload.id : null,
      eventType: typeof payload.eventType === 'string' ? payload.eventType : 'bold.payment.webhook',
      providerPaymentId: typeof payload.providerPaymentId === 'string' ? payload.providerPaymentId : typeof payload.paymentId === 'string' ? payload.paymentId : null,
      providerReference: typeof payload.providerReference === 'string' ? payload.providerReference : typeof payload.reference === 'string' ? payload.reference : null,
      orderReference: typeof payload.orderReference === 'string' ? payload.orderReference : null,
      status,
      amount: payload.amount == null ? null : Number(payload.amount),
      currency: typeof payload.currency === 'string' ? payload.currency : null,
      rawPayload: payload,
    };
  }

  verifyWebhookSignature(rawPayload: unknown, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = process.env.BOLD_WEBHOOK_SECRET;
    if (!secret) return false;
    const signature = headerValue(headers, 'x-bold-signature');
    if (!signature) return false;
    const serialized = JSON.stringify(rawPayload ?? {});
    const expected = createHmac('sha256', secret).update(serialized).digest('hex');
    const provided = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  }

  mapProviderStatus(providerStatus: ProviderPaymentStatus): WhatsappPaymentStatus {
    if (providerStatus === 'APPROVED') return WhatsappPaymentStatus.PAID;
    if (providerStatus === 'FAILED') return WhatsappPaymentStatus.FAILED;
    if (providerStatus === 'REVIEW') return WhatsappPaymentStatus.MANUAL_REVIEW;
    return WhatsappPaymentStatus.PENDING_ONLINE_PAYMENT;
  }
}
