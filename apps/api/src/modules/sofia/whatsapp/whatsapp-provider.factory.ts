import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HermesWhatsappProvider } from './hermes-whatsapp.provider';
import { MockWhatsappProvider } from './mock-whatsapp.provider';
import { NullWhatsappProvider } from './null-whatsapp.provider';
import { SofiaWhatsappQrGatewayProvider } from './qr-gateway/sofia-whatsapp-qr-gateway.provider';
import { WhatsappMode, WhatsappProviderAdapter, WhatsappProviderName } from './whatsapp-provider.adapter';

const WHATSAPP_MODES: WhatsappMode[] = ['disabled', 'mock', 'receive_only', 'supervised', 'auto'];
const WHATSAPP_PROVIDERS: WhatsappProviderName[] = ['mock', 'hermes', 'qr_gateway', 'none'];

@Injectable()
export class WhatsappProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly mockProvider: MockWhatsappProvider,
    private readonly hermesProvider: HermesWhatsappProvider,
    private readonly qrGatewayProvider: SofiaWhatsappQrGatewayProvider,
    private readonly nullProvider: NullWhatsappProvider,
  ) {}

  resolveMode(headers?: Record<string, string | string[] | undefined>): WhatsappMode {
    const headerMode = this.headerValue(headers, 'x-sofia-whatsapp-mode');
    const canUseHeaderOverride = this.configService.get<string>('NODE_ENV') === 'test';
    const requested = canUseHeaderOverride && headerMode ? headerMode : this.configService.get<string>('WHATSAPP_MODE');
    const mode = WHATSAPP_MODES.includes(requested as WhatsappMode) ? (requested as WhatsappMode) : 'disabled';
    if (mode === 'mock' && !canUseHeaderOverride) this.rejectMockProvider();
    return mode;
  }

  resolveProviderName(routeProvider?: string | null, headers?: Record<string, string | string[] | undefined>): WhatsappProviderName {
    const headerProvider = this.headerValue(headers, 'x-sofia-whatsapp-provider');
    const canUseHeaderOverride = this.configService.get<string>('NODE_ENV') === 'test';
    const configuredProvider = this.configService.get<string>('WHATSAPP_PROVIDER');
    const configured = canUseHeaderOverride
      ? headerProvider || routeProvider || configuredProvider
      : configuredProvider;
    const provider = WHATSAPP_PROVIDERS.includes(configured as WhatsappProviderName) ? (configured as WhatsappProviderName) : 'none';
    if (provider === 'mock' && !canUseHeaderOverride) this.rejectMockProvider();
    return provider;
  }

  getProvider(providerName: WhatsappProviderName): WhatsappProviderAdapter {
    if (providerName === 'mock') {
      if (this.configService.get<string>('NODE_ENV') !== 'test') this.rejectMockProvider();
      return this.mockProvider;
    }
    if (providerName === 'qr_gateway') return this.qrGatewayProvider;
    if (providerName === 'hermes' && this.isHermesConfigured()) return this.hermesProvider;
    if (providerName === 'hermes') return this.nullProvider;
    return this.nullProvider;
  }

  getStatus() {
    const mode = this.resolveMode();
    const provider = this.resolveProviderName();
    return {
      mode,
      provider,
      qrGatewayConfigured: provider === 'qr_gateway',
      hermesConfigured: this.isHermesConfigured(),
      autoReplyEnabled: this.configService.get<boolean>('SOFIA_AUTO_REPLY_ENABLED') ?? false,
      autoReplyMinConfidence: Number(this.configService.get<number>('SOFIA_AUTO_REPLY_MIN_CONFIDENCE') ?? 0.82),
      humanHandoffEnabled: this.configService.get<boolean>('SOFIA_HUMAN_HANDOFF_ENABLED') ?? true,
      replyOutsideHours: this.configService.get<boolean>('SOFIA_REPLY_OUTSIDE_HOURS') ?? false,
      maxRetries: Number(this.configService.get<number>('HERMES_MAX_RETRIES') ?? 3),
      dedupTtlMinutes: Number(this.configService.get<number>('SOFIA_WHATSAPP_DEDUP_TTL_MINUTES') ?? 1440),
      safeByDefault: mode === 'disabled' || mode === 'receive_only' || provider === 'none' || provider === 'mock' || provider === 'qr_gateway',
    };
  }

  isAutoReplyAllowed(confidence: number, isOpen: boolean, headers?: Record<string, string | string[] | undefined>) {
    const headerEnabled = this.headerValue(headers, 'x-sofia-auto-reply-enabled');
    const canUseHeaderOverride = this.configService.get<string>('NODE_ENV') === 'test';
    const enabled =
      canUseHeaderOverride && headerEnabled != null
        ? headerEnabled === 'true'
        : this.configService.get<boolean>('SOFIA_AUTO_REPLY_ENABLED') ?? false;
    const minConfidence = Number(this.configService.get<number>('SOFIA_AUTO_REPLY_MIN_CONFIDENCE') ?? 0.82);
    const replyOutsideHours = this.configService.get<boolean>('SOFIA_REPLY_OUTSIDE_HOURS') ?? false;
    return enabled && confidence >= minConfidence && (isOpen || replyOutsideHours);
  }

  maxRetries() {
    return Number(this.configService.get<number>('HERMES_MAX_RETRIES') ?? 3);
  }

  private isHermesConfigured() {
    return Boolean(
      this.configService.get<string>('HERMES_BASE_URL') &&
        this.configService.get<string>('HERMES_API_TOKEN') &&
        this.configService.get<string>('HERMES_WEBHOOK_SECRET'),
    );
  }

  private rejectMockProvider(): never {
    throw new BadRequestException({ code: 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN' });
  }

  private headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string) {
    if (!headers) return null;
    const lowerName = name.toLowerCase();
    const value =
      headers[name] ??
      headers[lowerName] ??
      Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)?.[1];
    return Array.isArray(value) ? value[0] : value ?? null;
  }
}
