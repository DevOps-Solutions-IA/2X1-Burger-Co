import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SofiaRuntimeSafetyService } from '../../runtime-safety/sofia-runtime-safety.service';
import { WhatsappProviderFactory } from '../whatsapp-provider.factory';
import type { OutboundMessageResult, WhatsappProductionProvider } from './whatsapp-production.types';

@Injectable()
export class WhatsappOutboundGateway {
  constructor(
    private readonly config: ConfigService,
    private readonly safety: SofiaRuntimeSafetyService,
    private readonly providers: WhatsappProviderFactory,
  ) {}

  async send(input: { provider: WhatsappProductionProvider; to: string; body: string; mediaUrl: string | null; idempotencyKey: string }): Promise<OutboundMessageResult> {
    const state = await this.safety.getState();
    const enabled = this.config.get<boolean>('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED') === true;
    if (!enabled || !state.effective.realSendingEnabled || state.globalPaused || state.killSwitchActive) {
      throw new ForbiddenException({ code: 'WHATSAPP_REAL_SEND_DISABLED' });
    }
    const provider = this.providers.getProvider(input.provider);
    try {
      const result = input.mediaUrl
        ? await provider.sendMediaMessage({ to: input.to, body: input.body, mediaUrl: input.mediaUrl, idempotencyKey: input.idempotencyKey })
        : await provider.sendTextMessage({ to: input.to, body: input.body, idempotencyKey: input.idempotencyKey });
      if (result.status === 'SENT' && !this.isValidProviderMessageId(result.providerMessageId)) {
        return { code: 'WHATSAPP_UNKNOWN_RESULT', providerMessageId: null, acceptedAt: null, retryable: false, unknownResult: true };
      }
      return {
        code: result.status === 'SENT' ? 'WHATSAPP_SENT' : 'WHATSAPP_PROVIDER_REJECTED', providerMessageId: result.providerMessageId,
        acceptedAt: result.status === 'SENT' ? new Date() : null, retryable: false, unknownResult: false,
      };
    } catch {
      return { code: 'WHATSAPP_UNKNOWN_RESULT', providerMessageId: null, acceptedAt: null, retryable: false, unknownResult: true };
    }
  }

  private isValidProviderMessageId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && /^[\x21-\x7e]+$/.test(value);
  }
}
