import { Injectable } from '@nestjs/common';
import {
  SofiaAIAnalysisInput,
  SofiaAIAnalysisOutput,
  SofiaAIExtractedItem,
  SofiaAIHealth,
  SofiaAIProviderAdapter,
} from './sofia-ai-provider.adapter';

@Injectable()
export class NullAIProvider extends SofiaAIProviderAdapter {
  readonly provider = 'null' as const;

  async analyzeMessage(input: SofiaAIAnalysisInput): Promise<SofiaAIAnalysisOutput> {
    return {
      ...this.rulesOutput(input, ['AI_PROVIDER_USED:null', 'AI_PROVIDER_DISABLED']),
      provider: this.provider,
      suggestedReply: 'Déjame confirmarlo con el equipo para no darte información incorrecta.',
      shouldHandoff: true,
      handoffReason: 'AI_DISABLED',
    };
  }

  async classifyIntent(input: SofiaAIAnalysisInput) {
    return { intent: input.ruleIntent, confidence: Math.min(input.ruleConfidence, 0.35) };
  }

  async extractOrderEntities(_input: SofiaAIAnalysisInput): Promise<SofiaAIExtractedItem[]> {
    return [];
  }

  async draftReply() {
    return 'Déjame confirmarlo con el equipo para no darte información incorrecta.';
  }

  async evaluateConfidence() {
    return 0.2;
  }

  async shouldHandoff() {
    return true;
  }

  async healthCheck(): Promise<SofiaAIHealth> {
    return {
      provider: this.provider,
      configured: false,
      enabled: false,
      ok: true,
      message: 'IA deshabilitada de forma segura.',
    };
  }
}
