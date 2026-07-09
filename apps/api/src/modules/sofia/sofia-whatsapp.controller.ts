import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { SofiaWhatsappService } from './sofia-whatsapp.service';

@Controller('integrations/whatsapp')
export class SofiaWhatsappWebhookController {
  constructor(private readonly sofiaWhatsappService: SofiaWhatsappService) {}

  @Post(':provider/webhook')
  receiveWhatsappWebhook(
    @Param('provider') provider: string,
    @Body() rawPayload: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.sofiaWhatsappService.processInboundWebhook(provider, rawPayload, headers);
  }
}

@Controller('integrations/hermes/whatsapp')
export class SofiaHermesWhatsappWebhookController {
  constructor(private readonly sofiaWhatsappService: SofiaWhatsappService) {}

  @Post('webhook')
  receiveHermesWebhook(
    @Body() rawPayload: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.sofiaWhatsappService.processInboundWebhook('hermes', rawPayload, headers);
  }
}
