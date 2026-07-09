import { BadRequestException, Injectable } from '@nestjs/common';
import { WhatsappPaymentStatus } from '@prisma/client';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  ParsedWebhookPayment,
  PaymentProviderAdapter,
  ProviderPaymentStatus,
} from './payment-provider.adapter';

@Injectable()
export class NullPaymentProvider implements PaymentProviderAdapter {
  readonly provider = 'NONE' as const;

  async createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    throw new BadRequestException('Pago en línea no disponible.');
  }

  async getPaymentStatus(_reference: string): Promise<ProviderPaymentStatus> {
    return 'PENDING';
  }

  parseWebhook(_rawPayload: unknown): ParsedWebhookPayment {
    throw new BadRequestException('Proveedor de pagos no disponible.');
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  mapProviderStatus(): WhatsappPaymentStatus {
    return WhatsappPaymentStatus.PENDING_ONLINE_PAYMENT;
  }
}
