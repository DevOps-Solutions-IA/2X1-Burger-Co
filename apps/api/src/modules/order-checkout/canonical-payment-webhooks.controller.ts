import { BadRequestException, Body, Controller, Headers, Param, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';

@Controller('integrations/payments/canonical-webhook')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class CanonicalPaymentWebhooksController {
  constructor(private readonly webhooks: CanonicalPaymentWebhookService) {}

  @Post(':provider')
  receive(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (provider.trim().toUpperCase() !== 'BOLD') {
      throw new BadRequestException({ code: 'PAYMENT_PROVIDER_UNSUPPORTED' });
    }
    return this.webhooks.processBold({ rawPayload: body, rawBody: request.rawBody, headers });
  }
}

