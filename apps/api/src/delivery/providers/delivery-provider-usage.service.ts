import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ProviderUsageDecision = {
  allowed: boolean;
  warnings: string[];
};

@Injectable()
export class DeliveryProviderUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async beforeCall(provider: string, endpoint: string, dailyLimit?: number | null): Promise<ProviderUsageDecision> {
    const usageDate = startOfUtcDay(new Date());
    const record = await this.prisma.deliveryProviderUsage.findUnique({
      where: {
        provider_endpoint_usageDate: {
          provider,
          endpoint,
          usageDate,
        },
      },
    });

    if (record?.circuitOpenUntil && record.circuitOpenUntil > new Date()) {
      return { allowed: false, warnings: ['PROVIDER_CIRCUIT_OPEN'] };
    }

    if (!dailyLimit || dailyLimit <= 0) {
      return { allowed: true, warnings: [] };
    }

    const softPercent =
      provider === 'google'
        ? Number(process.env.DELIVERY_GOOGLE_SOFT_LIMIT_PERCENT ?? process.env.DELIVERY_PROVIDER_QUOTA_SOFT_LIMIT_PERCENT ?? 85)
        : Number(process.env.DELIVERY_PROVIDER_QUOTA_SOFT_LIMIT_PERCENT ?? 85);
    const hardPercent =
      provider === 'google'
        ? Number(process.env.DELIVERY_GOOGLE_HARD_LIMIT_PERCENT ?? process.env.DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT ?? 95)
        : Number(process.env.DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT ?? 95);
    const softLimit = Math.floor(dailyLimit * (softPercent / 100));
    const hardLimit = Math.floor(dailyLimit * (hardPercent / 100));
    const count = record?.requestCount ?? 0;

    if (count >= hardLimit) {
      return { allowed: false, warnings: ['PROVIDER_QUOTA_HARD_LIMIT'] };
    }

    return { allowed: true, warnings: count >= softLimit ? ['PROVIDER_QUOTA_SOFT_LIMIT'] : [] };
  }

  async recordSuccess(provider: string, endpoint: string) {
    await this.upsert(provider, endpoint, {
      requestCount: { increment: 1 },
      successCount: { increment: 1 },
      lastStatus: 'SUCCESS',
      lastErrorCode: null,
      lastErrorAt: null,
    });
  }

  async recordError(provider: string, endpoint: string, errorCode: string) {
    const usageDate = startOfUtcDay(new Date());
    const threshold = Number(process.env.DELIVERY_CIRCUIT_BREAKER_ERROR_THRESHOLD ?? 5);
    const cooldownMinutes = Number(process.env.DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MINUTES ?? 10);
    const existing = await this.prisma.deliveryProviderUsage.findUnique({
      where: {
        provider_endpoint_usageDate: {
          provider,
          endpoint,
          usageDate,
        },
      },
    });
    const nextErrorCount = (existing?.errorCount ?? 0) + 1;
    const circuitOpenUntil = nextErrorCount >= threshold ? new Date(Date.now() + cooldownMinutes * 60_000) : undefined;

    await this.upsert(provider, endpoint, {
      requestCount: { increment: 1 },
      errorCount: { increment: 1 },
      lastStatus: 'ERROR',
      lastErrorCode: errorCode,
      lastErrorAt: new Date(),
      ...(circuitOpenUntil ? { circuitOpenUntil } : {}),
    });
  }

  private async upsert(provider: string, endpoint: string, update: Prisma.DeliveryProviderUsageUpdateInput) {
    const usageDate = startOfUtcDay(new Date());
    await this.prisma.deliveryProviderUsage.upsert({
      where: {
        provider_endpoint_usageDate: {
          provider,
          endpoint,
          usageDate,
        },
      },
      update,
      create: {
        provider,
        endpoint,
        usageDate,
        requestCount: 1,
        successCount: update.successCount ? 1 : 0,
        errorCount: update.errorCount ? 1 : 0,
        lastStatus: typeof update.lastStatus === 'string' ? update.lastStatus : null,
        lastErrorCode: typeof update.lastErrorCode === 'string' ? update.lastErrorCode : null,
        lastErrorAt: update.lastErrorAt instanceof Date ? update.lastErrorAt : null,
        circuitOpenUntil: update.circuitOpenUntil instanceof Date ? update.circuitOpenUntil : null,
      },
    });
  }
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
