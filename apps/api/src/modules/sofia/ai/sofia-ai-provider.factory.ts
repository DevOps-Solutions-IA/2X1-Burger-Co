import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepSeekAIProvider } from './deepseek-ai.provider';
import { NullAIProvider } from './null-ai.provider';
import { RulesAIProvider } from './rules-ai.provider';
import {
  SofiaAIAnalysisInput,
  SofiaAIAnalysisOutput,
  SofiaAIMode,
  SofiaAIProviderName,
} from './sofia-ai-provider.adapter';
import { SofiaSafetyGuard } from './sofia-ai-safety.guard';

type HeaderMap = Record<string, string | string[] | undefined>;

const AI_PROVIDERS: Array<Exclude<SofiaAIProviderName, 'null'>> = ['rules', 'deepseek', 'hybrid'];
const AI_MODES: SofiaAIMode[] = ['disabled', 'dry_run', 'suggest', 'supervised', 'auto'];

@Injectable()
export class SofiaAIProviderFactory {
  private lastFallbackAt: Date | null = null;
  private lastFallbackReason: string | null = null;
  private safetyBlocks = 0;
  private handoffs = 0;
  private responsesToday = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly rulesProvider: RulesAIProvider,
    private readonly deepSeekProvider: DeepSeekAIProvider,
    private readonly nullProvider: NullAIProvider,
    private readonly safetyGuard: SofiaSafetyGuard,
  ) {}

  resolveMode(headers?: HeaderMap): SofiaAIMode {
    const override = this.headerValue(headers, 'x-sofia-ai-mode');
    const requested = this.canUseHeaderOverride() && override ? override : this.configService.get<string>('SOFIA_AI_MODE');
    return AI_MODES.includes(requested as SofiaAIMode) ? (requested as SofiaAIMode) : 'disabled';
  }

  resolveProvider(headers?: HeaderMap): Exclude<SofiaAIProviderName, 'null'> {
    const override = this.headerValue(headers, 'x-sofia-ai-provider');
    const requested = this.canUseHeaderOverride() && override ? override : this.configService.get<string>('SOFIA_AI_PROVIDER');
    return AI_PROVIDERS.includes(requested as Exclude<SofiaAIProviderName, 'null'>)
      ? (requested as Exclude<SofiaAIProviderName, 'null'>)
      : 'rules';
  }

  resolveMockScenario(headers?: HeaderMap) {
    if (!this.canUseHeaderOverride()) return null;
    return this.headerValue(headers, 'x-sofia-ai-mock-scenario') ?? null;
  }

  async analyze(
    input: Omit<SofiaAIAnalysisInput, 'mode' | 'mockScenario'>,
    headers?: HeaderMap,
  ): Promise<{ raw: SofiaAIAnalysisOutput; safe: SofiaAIAnalysisOutput }> {
    const mode = this.resolveMode(headers);
    const providerName = this.resolveProvider(headers);
    const mockScenario = this.resolveMockScenario(headers);
    const analysisInput = { ...input, mode, mockScenario };

    let output: SofiaAIAnalysisOutput;
    if (mode === 'disabled') {
      output = await this.rulesProvider.analyzeMessage(analysisInput);
    } else if (providerName === 'rules') {
      output = await this.rulesProvider.analyzeMessage(analysisInput);
    } else if (providerName === 'deepseek') {
      output = await this.deepSeekProvider.analyzeMessage(analysisInput);
    } else if (providerName === 'hybrid') {
      output = await this.deepSeekProvider.analyzeMessage(analysisInput);
      if (output.fallbackUsed) {
        output = { ...(await this.rulesProvider.analyzeMessage(analysisInput)), provider: 'rules', fallbackUsed: true };
      }
    } else {
      output = await this.nullProvider.analyzeMessage(analysisInput);
    }

    if (output.fallbackUsed) {
      this.lastFallbackAt = new Date();
      this.lastFallbackReason = output.diagnostics.at(-1) ?? 'AI_PROVIDER_FALLBACK';
    }
    this.responsesToday += 1;
    const safe = this.safetyGuard.validate({
      aiOutput: output,
      normalizedMessage: input.normalizedMessage,
      availableProducts: input.availableProductsSnapshot,
      maxiFamilyCopy: input.businessRulesSnapshot.maxiFamilyCopy,
    });
    if (safe.safetyFlags.some((flag) => flag.startsWith('AI_SAFETY_BLOCKED') || flag === 'MAXI_FAMILY_COPY_CORRECTED')) {
      this.safetyBlocks += 1;
    }
    if (safe.shouldHandoff) this.handoffs += 1;

    return { raw: output, safe };
  }

  async healthCheck(headers?: HeaderMap) {
    const provider = this.resolveProvider(headers);
    if (provider === 'deepseek' || provider === 'hybrid') return this.deepSeekProvider.healthCheck();
    return this.rulesProvider.healthCheck();
  }

  getStatus(headers?: HeaderMap) {
    const provider = this.resolveProvider(headers);
    const mode = this.resolveMode(headers);
    const deepseekConfigured = Boolean(this.configService.get<string>('DEEPSEEK_API_KEY') && this.configService.get<string>('DEEPSEEK_BASE_URL'));
    const deepseekEnabled =
      this.configService.get<boolean>('DEEPSEEK_ENABLED') === true ||
      (this.canUseHeaderOverride() && this.headerValue(headers, 'x-sofia-deepseek-enabled') === 'true');
    return {
      provider,
      mode,
      deepseekEnabled,
      deepseekConfigured,
      deepseekModel: this.configService.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash',
      minConfidence: this.configService.get<number>('SOFIA_AI_MIN_CONFIDENCE') ?? 0.82,
      logPrompts: this.configService.get<boolean>('SOFIA_AI_LOG_PROMPTS') === true,
      redactPersonalData: this.configService.get<boolean>('SOFIA_AI_REDACT_PERSONAL_DATA') !== false,
      lastHealthCheck: null,
      lastFallbackAt: this.lastFallbackAt?.toISOString() ?? null,
      lastFallbackReason: this.lastFallbackReason,
      responsesToday: this.responsesToday,
      safetyBlocksToday: this.safetyBlocks,
      handoffsToday: this.handoffs,
      apiKeyExposed: false,
      backendOnly: true,
      hermesSeparated: true,
      safeByDefault: mode === 'disabled' || mode === 'dry_run' || !deepseekEnabled || !deepseekConfigured,
    };
  }

  private canUseHeaderOverride() {
    return process.env.NODE_ENV === 'test';
  }

  private headerValue(headers: HeaderMap | undefined, key: string) {
    const raw = headers?.[key] ?? headers?.[key.toLowerCase()];
    return Array.isArray(raw) ? raw[0] : raw;
  }
}
