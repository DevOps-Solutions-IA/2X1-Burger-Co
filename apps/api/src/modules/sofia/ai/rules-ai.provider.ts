import { Injectable } from '@nestjs/common';
import {
  SofiaAIAnalysisInput,
  SofiaAIAnalysisOutput,
  SofiaAIExtractedItem,
  SofiaAIHealth,
  SofiaAIProviderAdapter,
} from './sofia-ai-provider.adapter';

@Injectable()
export class RulesAIProvider extends SofiaAIProviderAdapter {
  readonly provider = 'rules' as const;

  async analyzeMessage(input: SofiaAIAnalysisInput): Promise<SofiaAIAnalysisOutput> {
    return this.rulesOutput(input, ['AI_PROVIDER_USED:rules']);
  }

  async classifyIntent(input: SofiaAIAnalysisInput) {
    return { intent: input.ruleIntent, confidence: input.ruleConfidence };
  }

  async extractOrderEntities(_input: SofiaAIAnalysisInput): Promise<SofiaAIExtractedItem[]> {
    return [];
  }

  async draftReply(input: SofiaAIAnalysisInput) {
    return input.ruleSuggestedReply ?? null;
  }

  async evaluateConfidence(input: SofiaAIAnalysisInput) {
    return input.ruleConfidence;
  }

  async shouldHandoff(input: SofiaAIAnalysisInput) {
    return input.ruleIntent === 'ASK_HUMAN' || input.ruleConfidence < 0.45;
  }

  async healthCheck(): Promise<SofiaAIHealth> {
    return {
      provider: this.provider,
      configured: true,
      enabled: true,
      ok: true,
      message: 'RulesAIProvider activo como fallback local sin internet.',
    };
  }
}
