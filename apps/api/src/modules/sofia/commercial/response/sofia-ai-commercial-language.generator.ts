import { Injectable } from '@nestjs/common';
import { SofiaAIProviderFactory } from '../../ai/sofia-ai-provider.factory';
import type { CommercialFactEnvelope, CommercialLanguageGenerator } from './commercial-response.types';

@Injectable()
export class SofiaAICommercialLanguageGenerator implements CommercialLanguageGenerator {
  constructor(private readonly providers: SofiaAIProviderFactory) {}

  compose(envelope: CommercialFactEnvelope) {
    return this.providers.composeCommercialResponse(envelope);
  }
}
