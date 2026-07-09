import type { WhatsappPaymentStatus } from '@prisma/client';

export type OnlinePaymentProvider = 'MOCK' | 'BOLD' | 'NONE';
export type ProviderPaymentStatus = 'PENDING' | 'APPROVED' | 'FAILED' | 'REVIEW';

export type CreatePaymentInput = {
  orderReference: string;
  amount: number;
  currency: 'COP';
  customerName: string | null;
  customerPhone: string | null;
  description: string;
  metadata: Record<string, string | number | null>;
};

export type CreatePaymentResult = {
  provider: OnlinePaymentProvider;
  providerPaymentId: string;
  providerReference: string;
  checkoutUrl: string;
  status: ProviderPaymentStatus;
  rawPayload: Record<string, unknown>;
};

export type ParsedWebhookPayment = {
  eventId: string | null;
  eventType: string;
  providerPaymentId: string | null;
  providerReference: string | null;
  orderReference: string | null;
  status: ProviderPaymentStatus;
  amount: number | null;
  currency: string | null;
  rawPayload: Record<string, unknown>;
};

export interface PaymentProviderAdapter {
  readonly provider: OnlinePaymentProvider;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPaymentStatus(reference: string): Promise<ProviderPaymentStatus>;
  parseWebhook(rawPayload: unknown, headers: Record<string, string | string[] | undefined>): ParsedWebhookPayment;
  verifyWebhookSignature(rawPayload: unknown, headers: Record<string, string | string[] | undefined>): boolean;
  mapProviderStatus(providerStatus: ProviderPaymentStatus): WhatsappPaymentStatus;
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string) {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0] ?? '';
  return direct ?? '';
}
