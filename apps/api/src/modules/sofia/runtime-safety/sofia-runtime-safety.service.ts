import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SOFIA_RUNTIME_SAFETY_SETTING_KEYS,
  SofiaAllowlistDecision,
  SofiaRuntimeSafetyAction,
  SofiaRuntimeSafetyDecision,
  SofiaRuntimeSafetyState,
} from './sofia-runtime-safety.types';

type SafetyEvaluationOptions = {
  simulated?: boolean;
  state?: SofiaRuntimeSafetyState;
};

type SafetyAuditInput = {
  actorId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  phone?: string | null;
  reason?: string;
  blockers?: string[];
};

@Injectable()
export class SofiaRuntimeSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getState(): Promise<SofiaRuntimeSafetyState> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: Object.values(SOFIA_RUNTIME_SAFETY_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const values = new Map(settings.map((setting) => [setting.key, this.settingValue(setting.value)]));
    const globalPaused = values.get(SOFIA_RUNTIME_SAFETY_SETTING_KEYS.globalPaused)?.paused === true;
    const killSwitchActive = values.get(SOFIA_RUNTIME_SAFETY_SETTING_KEYS.killSwitch)?.active === true;

    return {
      policy: 'SUPERVISED_PREPRODUCTION',
      declared: {
        realSendingEnabled: this.configBoolean('WHATSAPP_QR_ALLOW_REAL_SEND'),
        autoReplyEnabled: this.configBoolean('SOFIA_AUTO_REPLY_ENABLED'),
        autoSafeEnabled: this.configBoolean('SOFIA_AUTO_SAFE_ENABLED'),
        productionEnabled: this.configBoolean('SOFIA_PRODUCTION_ENABLED'),
      },
      effective: {
        realSendingEnabled: false,
        autoReplyEnabled: false,
        autoSafeEnabled: false,
        productionEnabled: false,
        whatsappCanMarkPaid: false,
      },
      globalPaused,
      killSwitchActive,
      automationBlocked: globalPaused || killSwitchActive,
      precedence: ['KILL_SWITCH', 'PAUSE', 'PRODUCTION', 'AUTO_SAFE', 'AUTO_REPLY', 'REAL_SEND'],
    };
  }

  async evaluate(
    action: SofiaRuntimeSafetyAction,
    options: SafetyEvaluationOptions = {},
  ): Promise<SofiaRuntimeSafetyDecision> {
    const state = options.state ?? (await this.getState());
    const blockers: string[] = [];
    if (state.killSwitchActive) blockers.push('KILL_SWITCH_ACTIVE');
    if (state.globalPaused) blockers.push('GLOBAL_PAUSED');

    if (action === 'MARK_PAID') blockers.push('WHATSAPP_PAID_FORBIDDEN');
    if (action === 'PRODUCTIVE_ACTION') blockers.push('PRODUCTION_DISABLED');
    if (action === 'AUTO_SAFE') blockers.push('PRODUCTION_DISABLED', 'AUTO_SAFE_DISABLED');
    if (action === 'AUTO_REPLY') blockers.push('PRODUCTION_DISABLED', 'AUTO_REPLY_DISABLED');
    if (action === 'OUTBOUND_SEND' && !options.simulated) blockers.push('PRODUCTION_DISABLED', 'REAL_SEND_DISABLED');

    const uniqueBlockers = [...new Set(blockers)];
    return {
      action,
      allowed: uniqueBlockers.length === 0,
      reason: uniqueBlockers[0] ?? (options.simulated ? 'SANDBOX_SIMULATION_ALLOWED' : 'SAFETY_GATE_ALLOWED'),
      blockers: uniqueBlockers,
      state,
    };
  }

  evaluateAllowlist(
    phone: string,
    options: { enabled?: boolean; allowedPhones?: string } = {},
  ): SofiaAllowlistDecision {
    const enabled = options.enabled ?? this.configBoolean('SOFIA_QR_PILOT_ALLOWLIST_ENABLED');
    const normalized = this.normalizePhone(phone);
    if (!normalized) {
      return { allowed: false, reason: 'INVALID_PHONE', phoneMasked: null, phoneHash: null };
    }
    const safeIdentity = {
      phoneMasked: this.maskPhone(normalized),
      phoneHash: this.hash(normalized).slice(0, 16),
    };
    if (!enabled) return { allowed: true, reason: 'ALLOWLIST_DISABLED', ...safeIdentity };

    const rawAllowed =
      options.allowedPhones ??
      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES ??
      this.configService.get<string>('SOFIA_QR_PILOT_ALLOWED_PHONES') ??
      '';
    const allowedPhones = rawAllowed
      .split(',')
      .map((candidate) => this.normalizePhone(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));
    const allowed = allowedPhones.includes(normalized);
    return {
      allowed,
      reason: allowed ? 'ALLOWLIST_ALLOWED' : 'ALLOWLIST_REQUIRED',
      ...safeIdentity,
    };
  }

  async recordBlocked(action: SofiaRuntimeSafetyAction, input: SafetyAuditInput = {}) {
    const phone = input.phone ? this.normalizePhone(input.phone) : null;
    const values = {
      result: 'BLOCKED',
      reason: input.reason ?? 'SAFETY_GATE_BLOCKED',
      blockers: input.blockers ?? [],
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey ? this.hash(input.idempotencyKey).slice(0, 20) : null,
      phoneMasked: phone ? this.maskPhone(phone) : null,
      phoneHash: phone ? this.hash(phone).slice(0, 16) : null,
      valuesSanitized: true,
    };
    return this.prisma.auditLog.create({
      data: {
        userId: input.actorId ?? null,
        action: `SOFIA_RUNTIME_${action}_BLOCKED`,
        module: 'SofiaRuntimeSafety',
        entity: 'RuntimeSafetyGate',
        entityId: input.idempotencyKey ? this.hash(input.idempotencyKey).slice(0, 20) : null,
        newValues: values as Prisma.InputJsonValue,
      },
    });
  }

  async getCounters() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [received, blocked, sends, sendBlocked, duplicates, paymentSensitive, humanEscalations, autoReply, autoSafe, timeouts, allowlistDenied] =
      await Promise.all([
        this.prisma.whatsappInboundEvent.count({ where: { receivedAt: { gte: since } } }),
        this.prisma.auditLog.count({ where: { module: 'SofiaRuntimeSafety', createdAt: { gte: since } } }),
        this.prisma.whatsappOutboundMessage.count({ where: { attempts: { gt: 0 }, createdAt: { gte: since } } }),
        this.prisma.auditLog.count({ where: { action: 'SOFIA_RUNTIME_OUTBOUND_SEND_BLOCKED', createdAt: { gte: since } } }),
        this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'DUPLICATE_IGNORED', receivedAt: { gte: since } } }),
        this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { reasonCodesJson: { array_contains: ['PAYMENT_SENSITIVE'] }, createdAt: { gte: since } } }),
        this.prisma.whatsappConversation.count({ where: { humanStatus: 'HUMAN_REQUIRED', updatedAt: { gte: since } } }),
        this.prisma.auditLog.count({ where: { action: 'SOFIA_RUNTIME_AUTO_REPLY_BLOCKED', createdAt: { gte: since } } }),
        this.prisma.sofiaAutoSafeDecisionEvent.count({ where: { createdAt: { gte: since } } }),
        this.prisma.auditLog.count({ where: { action: { contains: 'TIMEOUT' }, createdAt: { gte: since } } }),
        this.prisma.whatsappInboundEvent.count({ where: { processingStatus: 'ALLOWLIST_REQUIRED', receivedAt: { gte: since } } }),
      ]);
    return {
      messages_received_total: received,
      messages_blocked_total: blocked,
      send_attempts_total: sends,
      send_blocked_total: sendBlocked,
      duplicate_events_total: duplicates,
      payment_sensitive_total: paymentSensitive,
      human_escalations_total: humanEscalations,
      auto_reply_attempts_total: autoReply,
      auto_safe_attempts_total: autoSafe,
      timeout_total: timeouts,
      allowlist_denied_total: allowlistDenied,
    };
  }

  async getPublicStatus() {
    const [state, counters] = await Promise.all([this.getState(), this.getCounters()]);
    return { generatedAt: new Date().toISOString(), state, counters, noSecrets: true, noPii: true };
  }

  normalizePhone(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed || /[*xX]/.test(trimmed)) return null;
    let digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
    if (digits.length === 12 && digits.startsWith('573')) return digits;
    return null;
  }

  private configBoolean(key: string) {
    const runtimeValue = process.env[key];
    if (runtimeValue !== undefined) {
      return ['true', '1'].includes(runtimeValue.trim().toLowerCase());
    }
    return this.configService.get<boolean>(key) === true;
  }

  private settingValue(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private maskPhone(phone: string) {
    return `***${phone.slice(-4)}`;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
