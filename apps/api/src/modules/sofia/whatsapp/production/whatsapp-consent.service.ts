import { Inject, Injectable } from '@nestjs/common';
import type { WhatsappMessagePurpose } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

@Injectable()
export class WhatsappConsentService {
  constructor(@Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository) {}

  evaluate(customerId: string | null, purpose: WhatsappMessagePurpose) {
    return this.repository.consentDecision(customerId, purpose);
  }
}
