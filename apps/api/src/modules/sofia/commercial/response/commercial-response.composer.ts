import { Inject, Injectable } from '@nestjs/common';
import { CommercialResponseValidator } from './commercial-response.validator';
import {
  COMMERCIAL_LANGUAGE_GENERATOR,
  type CommercialComposedResponse,
  type CommercialFactEnvelope,
  type CommercialLanguageGenerator,
} from './commercial-response.types';
import { SafeCommercialResponseTemplates } from './safe-commercial-response.templates';

const templateOnlyPurposes = new Set([
  'ASK_PRODUCT',
  'CLARIFY_PRODUCT',
  'ASK_ADDRESS',
]);

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

@Injectable()
export class CommercialResponseComposer {
  constructor(
    @Inject(COMMERCIAL_LANGUAGE_GENERATOR) private readonly generator: CommercialLanguageGenerator,
    private readonly validator: CommercialResponseValidator,
    private readonly templates: SafeCommercialResponseTemplates,
  ) {}

  async compose(input: CommercialFactEnvelope): Promise<CommercialComposedResponse> {
    const envelope = deepFreeze(structuredClone(input));
    let candidate: string | null = null;
    const requiresExactTemplate = envelope.addressSafe !== null || templateOnlyPurposes.has(envelope.responsePurpose);
    if (!requiresExactTemplate) {
      try {
        candidate = await this.generator.compose(envelope);
      } catch {
        candidate = null;
      }
    }

    if (candidate) {
      const validation = this.validator.validate(candidate, envelope);
      if (validation.valid) return Object.freeze({ text: candidate.trim(), source: 'BOUNDED_AI', validation });
    }

    const text = this.templates.render(envelope);
    const validation = this.validator.validate(text, envelope);
    if (!validation.valid) throw new Error(`SOFIA_SAFE_TEMPLATE_INVALID:${validation.violations.join(',')}`);
    return Object.freeze({ text, source: 'SAFE_TEMPLATE', validation });
  }
}
