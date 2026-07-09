import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ExternalCache, ExternalCacheLookup } from './external-cache.interface';

@Injectable()
export class PrismaExternalCache implements ExternalCache {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(entry: ExternalCacheLookup): Promise<T | null> {
    const record = await this.prisma.externalApiCache.findUnique({
      where: {
        provider_cacheType_cacheKey: {
          provider: entry.provider,
          cacheType: entry.cacheType,
          cacheKey: entry.cacheKey,
        },
      },
    });

    if (!record) {
      return null;
    }

    if (record.expiresAt <= new Date()) {
      await this.prisma.externalApiCache
        .update({
          where: { id: record.id },
          data: { status: 'STALE' },
        })
        .catch(() => undefined);
      return null;
    }

    return record.responseJson as T;
  }

  async set<T>(entry: ExternalCacheLookup, value: T, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + Math.max(1, ttlSeconds) * 1000);
    const requestHash = entry.requestHash ?? hashCacheRequest(entry);

    await this.prisma.externalApiCache.upsert({
      where: {
        provider_cacheType_cacheKey: {
          provider: entry.provider,
          cacheType: entry.cacheType,
          cacheKey: entry.cacheKey,
        },
      },
      update: {
        requestHash,
        responseJson: value as Prisma.InputJsonValue,
        status: 'SUCCESS',
        expiresAt,
      },
      create: {
        provider: entry.provider,
        cacheType: entry.cacheType,
        cacheKey: entry.cacheKey,
        requestHash,
        responseJson: value as Prisma.InputJsonValue,
        status: 'SUCCESS',
        expiresAt,
      },
    });
  }

  async delete(entry: ExternalCacheLookup): Promise<void> {
    await this.prisma.externalApiCache.deleteMany({
      where: {
        provider: entry.provider,
        cacheType: entry.cacheType,
        cacheKey: entry.cacheKey,
      },
    });
  }
}

function hashCacheRequest(entry: ExternalCacheLookup) {
  return createHash('sha256')
    .update(`${entry.provider}:${entry.cacheType}:${entry.cacheKey}`)
    .digest('hex');
}
