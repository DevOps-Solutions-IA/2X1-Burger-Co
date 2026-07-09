import { Injectable } from '@nestjs/common';
import type { ExternalCache, ExternalCacheLookup } from './external-cache.interface';

type CacheRecord = {
  value: unknown;
  expiresAt: number;
};

@Injectable()
export class InMemoryExternalCache implements ExternalCache {
  private readonly records = new Map<string, CacheRecord>();

  async get<T>(entry: ExternalCacheLookup): Promise<T | null> {
    const recordKey = toRecordKey(entry);
    const record = this.records.get(recordKey);
    if (!record) {
      return null;
    }

    if (record.expiresAt <= Date.now()) {
      this.records.delete(recordKey);
      return null;
    }

    return record.value as T;
  }

  async set<T>(entry: ExternalCacheLookup, value: T, ttlSeconds: number): Promise<void> {
    this.records.set(toRecordKey(entry), {
      value,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  }

  async delete(entry: ExternalCacheLookup): Promise<void> {
    this.records.delete(toRecordKey(entry));
  }
}

function toRecordKey(entry: ExternalCacheLookup) {
  return `${entry.provider}:${entry.cacheType}:${entry.cacheKey}`;
}
