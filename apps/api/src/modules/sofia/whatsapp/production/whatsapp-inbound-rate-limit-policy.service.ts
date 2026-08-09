export type WhatsappInboundRateLimitInput = {
  accountId: string;
  senderIdentityHash?: string | null;
  now?: Date;
};

export type WhatsappInboundRateLimitDecision = {
  allowed: boolean;
  reasonCode: 'WHATSAPP_RATE_LIMIT_ALLOWED' | 'WHATSAPP_ACCOUNT_RATE_LIMITED' | 'WHATSAPP_SENDER_RATE_LIMITED';
  retryAfterMs: number;
  accountRemaining: number;
  senderRemaining: number | null;
};

export type WhatsappInboundRateLimitPolicy = {
  windowMs: number;
  accountLimit: number;
  senderLimit: number;
  maxTrackedAccounts: number;
  maxTrackedSenders: number;
};

type WindowCounter = {
  windowStartedAt: number;
  count: number;
};

const DEFAULT_POLICY: WhatsappInboundRateLimitPolicy = {
  windowMs: 60_000,
  accountLimit: 300,
  senderLimit: 20,
  maxTrackedAccounts: 100,
  maxTrackedSenders: 10_000,
};

export class WhatsappInboundRateLimitPolicyService {
  private readonly policy: WhatsappInboundRateLimitPolicy;
  private readonly accounts = new Map<string, WindowCounter>();
  private readonly senders = new Map<string, WindowCounter>();

  constructor(policy: Partial<WhatsappInboundRateLimitPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    for (const [key, value] of Object.entries(this.policy)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`WHATSAPP_RATE_LIMIT_POLICY_INVALID:${key}`);
    }
  }

  static fromEnvironment() {
    const raw = process.env.SOFIA_WHATSAPP_RATE_LIMIT_PER_MINUTE ?? '20';
    const senderLimit = Number(raw);
    if (!Number.isSafeInteger(senderLimit) || senderLimit <= 0 || senderLimit > 10_000) {
      throw new Error('WHATSAPP_RATE_LIMIT_ENV_INVALID');
    }
    return new WhatsappInboundRateLimitPolicyService({ senderLimit });
  }

  evaluate(input: WhatsappInboundRateLimitInput): WhatsappInboundRateLimitDecision {
    const now = input.now?.getTime() ?? Date.now();
    if (!Number.isFinite(now)) throw new Error('WHATSAPP_RATE_LIMIT_TIME_INVALID');
    const accountId = this.key(input.accountId, 191, 'WHATSAPP_RATE_LIMIT_ACCOUNT_INVALID');
    const senderHash = input.senderIdentityHash
      ? this.key(input.senderIdentityHash, 128, 'WHATSAPP_RATE_LIMIT_SENDER_INVALID').toLowerCase()
      : null;
    const account = this.consume(
      this.accounts,
      accountId,
      this.policy.accountLimit,
      this.policy.maxTrackedAccounts,
      now,
    );
    if (!account.allowed) {
      return {
        allowed: false,
        reasonCode: 'WHATSAPP_ACCOUNT_RATE_LIMITED',
        retryAfterMs: account.retryAfterMs,
        accountRemaining: 0,
        senderRemaining: null,
      };
    }

    if (!senderHash) {
      return {
        allowed: true,
        reasonCode: 'WHATSAPP_RATE_LIMIT_ALLOWED',
        retryAfterMs: 0,
        accountRemaining: account.remaining,
        senderRemaining: null,
      };
    }

    const senderKey = `${accountId}:${senderHash}`;
    const sender = this.consume(
      this.senders,
      senderKey,
      this.policy.senderLimit,
      this.policy.maxTrackedSenders,
      now,
    );
    if (!sender.allowed) {
      return {
        allowed: false,
        reasonCode: 'WHATSAPP_SENDER_RATE_LIMITED',
        retryAfterMs: sender.retryAfterMs,
        accountRemaining: account.remaining,
        senderRemaining: 0,
      };
    }
    return {
      allowed: true,
      reasonCode: 'WHATSAPP_RATE_LIMIT_ALLOWED',
      retryAfterMs: 0,
      accountRemaining: account.remaining,
      senderRemaining: sender.remaining,
    };
  }

  private consume(
    counters: Map<string, WindowCounter>,
    key: string,
    limit: number,
    maxTracked: number,
    now: number,
  ) {
    const windowStartedAt = Math.floor(now / this.policy.windowMs) * this.policy.windowMs;
    let counter = counters.get(key);
    if (!counter || counter.windowStartedAt !== windowStartedAt) {
      if (!counter && counters.size >= maxTracked) {
        this.pruneExpired(counters, windowStartedAt);
        if (counters.size >= maxTracked) {
          return { allowed: false, remaining: 0, retryAfterMs: this.retryAfter(windowStartedAt, now) };
        }
      }
      counter = { windowStartedAt, count: 0 };
      counters.set(key, counter);
    }
    counter.count += 1;
    return {
      allowed: counter.count <= limit,
      remaining: Math.max(0, limit - counter.count),
      retryAfterMs: counter.count <= limit ? 0 : this.retryAfter(windowStartedAt, now),
    };
  }

  private pruneExpired(counters: Map<string, WindowCounter>, currentWindowStartedAt: number) {
    for (const [key, counter] of counters) {
      if (counter.windowStartedAt < currentWindowStartedAt) counters.delete(key);
    }
  }

  private retryAfter(windowStartedAt: number, now: number) {
    return Math.max(1, windowStartedAt + this.policy.windowMs - now);
  }

  private key(value: unknown, maxLength: number, code: string) {
    if (typeof value !== 'string') throw new Error(code);
    const normalized = value.trim();
    const hasControlCharacters = Array.from(normalized).some((character) => {
      const characterCode = character.charCodeAt(0);
      return characterCode <= 31 || characterCode === 127;
    });
    if (!normalized || normalized.length > maxLength || hasControlCharacters) throw new Error(code);
    return normalized;
  }
}
