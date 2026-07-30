import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
    return Boolean(process.env.BOLD_API_KEY && process.env.BOLD_WEBHOOK_SECRET);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Bold no está configurado. No se inició pago real.');
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('El monto Bold debe ser un entero positivo en COP.');
    }
    const reference = input.orderReference.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
    if (!reference) throw new BadRequestException('La referencia Bold es inválida.');

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.BOLD_TIMEOUT_MS ?? 10000),
    );
    try {
      const baseUrl = (process.env.BOLD_BASE_URL ?? 'https://integrations.api.bold.co').replace(/\/$/, '');
      const ttlMinutes = Math.min(Math.max(Number(process.env.BOLD_PAYMENT_LINK_TTL_MINUTES ?? 20), 1), 1440);
      const response = await fetch(`${baseUrl}/online/link/v1`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `x-api-key ${process.env.BOLD_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': reference,
        },
        body: JSON.stringify({
          amount_type: 'CLOSE',
          amount: { currency: 'COP', total_amount: input.amount, tip_amount: 0 },
          reference,
          description: input.description.slice(0, 100),
          expiration_date: (Date.now() + ttlMinutes * 60_000) * 1_000_000,
          payment_methods: ['CREDIT_CARD', 'PSE', 'BOTON_BANCOLOMBIA', 'NEQUI'],
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        payload?: { payment_link?: string; url?: string };
        errors?: unknown[];
      } | null;
      const paymentLink = payload?.payload?.payment_link;
      const checkoutUrl = payload?.payload?.url;
      if (!response.ok || !paymentLink || !checkoutUrl) {
        throw new BadRequestException(`Bold rechazó la creación del link (${response.status}).`);
      }
      return {
        provider: this.provider,
        providerPaymentId: paymentLink,
        providerReference: reference,
        checkoutUrl,
        status: 'PENDING',
        rawPayload: { paymentLink, checkoutUrl, reference, responseStatus: response.status },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getPaymentStatus(reference: string): Promise<ProviderPaymentStatus> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Bold no está configurado.');
    }
    const safeReference = reference.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (!safeReference) throw new BadRequestException('Referencia Bold inválida.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.BOLD_TIMEOUT_MS ?? 10000));
    try {
      const baseUrl = (process.env.BOLD_BASE_URL ?? 'https://integrations.api.bold.co').replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/online/link/v1/${encodeURIComponent(safeReference)}`, {
        signal: controller.signal,
        headers: { Authorization: `x-api-key ${process.env.BOLD_API_KEY}` },
      });
      if (!response.ok) throw new BadRequestException(`No se pudo consultar Bold (${response.status}).`);
      const payload = (await response.json()) as { status?: string };
      const status = String(payload.status ?? '').toUpperCase();
      if (status === 'PAID') return 'APPROVED';
      if (['REJECTED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'FAILED';
      return 'PENDING';
    } finally {
      clearTimeout(timeout);
    }
  }

  parseWebhook(rawPayload: unknown): ParsedWebhookPayment {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      throw new BadRequestException('Webhook Bold inválido.');
    }
    const payload = rawPayload as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : payload;
    const amount =
      data.amount && typeof data.amount === 'object' && !Array.isArray(data.amount)
        ? (data.amount as Record<string, unknown>)
        : null;
    const metadata =
      data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : null;
    const eventType = String(payload.type ?? payload.eventType ?? 'bold.payment.webhook').toUpperCase();
    const rawStatus = String(data.status ?? payload.status ?? eventType).toUpperCase();
    const status: ProviderPaymentStatus =
      ['APPROVED', 'PAID', 'SUCCESSFUL', 'SALE_APPROVED'].includes(rawStatus)
        ? 'APPROVED'
        : ['FAILED', 'REJECTED', 'DECLINED', 'SALE_REJECTED', 'VOID_APPROVED'].includes(rawStatus)
          ? 'FAILED'
          : rawStatus === 'REVIEW'
            ? 'REVIEW'
            : 'PENDING';

    return {
      eventId: typeof payload.eventId === 'string' ? payload.eventId : typeof payload.id === 'string' ? payload.id : null,
      eventType,
      providerPaymentId: typeof data.payment_id === 'string' ? data.payment_id : typeof data.providerPaymentId === 'string' ? data.providerPaymentId : null,
      providerReference: typeof metadata?.reference === 'string' ? metadata.reference : typeof data.reference === 'string' ? data.reference : null,
      orderReference:
        typeof metadata?.reference === 'string'
          ? metadata.reference
          : typeof data.reference === 'string'
            ? data.reference
            : typeof data.orderReference === 'string'
              ? data.orderReference
              : null,
      status,
      amount: amount?.total == null ? null : Number(amount.total),
      currency: typeof amount?.currency === 'string' ? amount.currency : amount?.total != null ? 'COP' : null,
      rawPayload: {
        eventId: typeof payload.id === 'string' ? payload.id : null,
        eventType,
        paymentId: typeof data.payment_id === 'string' ? data.payment_id : null,
        reference: typeof metadata?.reference === 'string' ? metadata.reference : null,
        status,
        amountTotal: amount?.total == null ? null : Number(amount.total),
        currency: typeof amount?.currency === 'string' ? amount.currency : 'COP',
      },
    };
  }

  verifyWebhookSignature(
    rawPayload: unknown,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ): boolean {
    const secret = process.env.BOLD_WEBHOOK_SECRET;
    if (!secret) return false;
    const signature = headerValue(headers, 'x-bold-signature');
    if (!signature) return false;
    if (!rawBody?.length) return false;
    const expected = createHmac('sha256', secret).update(rawBody.toString('base64')).digest('hex');
    const provided = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  }

}
